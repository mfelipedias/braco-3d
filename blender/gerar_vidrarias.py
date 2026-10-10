# Gera vidrarias de química dimensionadas para a garra do braço e exporta GLB.
# Cada vidraria é um empty "Vidraria_*" com origem no centro da base e extras de pega:
#   grip_height  (m, altura do ponto de pega a partir da base)
#   grip_diameter (m, diâmetro externo nesse ponto)
import bpy, bmesh, math, os
from mathutils import Vector

# Caminhos relativos ao repositório: GLB → web/models, .blend → blender/cenas, previews → docs/img
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODELS = os.path.join(ROOT, "web", "models")
CENAS = os.path.join(ROOT, "blender", "cenas")
IMG = os.path.join(ROOT, "docs", "img")
for _d in (MODELS, CENAS, IMG):
    os.makedirs(_d, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection

# ---------------------------------------------------------------- materiais
def make_mat(name, color, metallic=0.0, rough=0.5, transmission=0.0, alpha=1.0, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    b.inputs["IOR"].default_value = 1.45
    for key in ("Transmission Weight", "Transmission"):
        if key in b.inputs:
            b.inputs[key].default_value = transmission
            break
    b.inputs["Alpha"].default_value = alpha
    m.diffuse_color = (*color, alpha)
    m.use_backface_culling = not double
    for attr, val in (("use_raytrace_refraction", transmission > 0), ("surface_render_method", "BLENDED" if alpha < 1 else "DITHERED")):
        try:
            setattr(m, attr, val)
        except (AttributeError, TypeError):
            pass
    return m

M_VIDRO = make_mat("Vidro", (0.92, 0.97, 1.0), 0, 0.03, transmission=1.0)
M_AMBAR = make_mat("Vidro_Ambar", (0.60, 0.26, 0.03), 0, 0.05, transmission=1.0)
M_ESMALTE = make_mat("Esmalte", (0.95, 0.95, 0.95), 0, 0.5, double=True)
M_ROTULO = make_mat("Rotulo", (0.97, 0.96, 0.92), 0, 0.7, double=True)
M_TAMPA = make_mat("Plastico_Azul", (0.03, 0.12, 0.45), 0, 0.4)
LIQ = {
    "azul": make_mat("Liquido_Azul", (0.05, 0.30, 0.95), 0, 0.15),
    "verde": make_mat("Liquido_Verde", (0.10, 0.75, 0.20), 0, 0.15),
    "laranja": make_mat("Liquido_Laranja", (0.95, 0.40, 0.03), 0, 0.15),
    "roxo": make_mat("Liquido_Roxo", (0.50, 0.10, 0.75), 0, 0.15),
}

# ---------------------------------------------------------------- helpers
def to_obj(name, bm, mat, parent, angle=40):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle))
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    o.parent = parent
    return o

def lathe(profile, segs=64):
    """Perfil (r, z) girado em torno de Z. Pontos com r=0 viram polos."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs),
                                        r * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for i in range(segs):
            j = (i + 1) % segs
            if len(a) == 1:
                bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    return bm

def vessel(outer, inner, segs=64):
    """Parede de vidro sólida: perfil externo (base→borda) + interno percorrido de volta."""
    return lathe(outer + inner[::-1], segs)

def liquid(inner, level, shrink=0.0004, segs=64):
    """Volume de líquido seguindo a parede interna (lista base→topo) até a altura `level`."""
    pts = [(0, inner[0][1] + shrink)]
    for (r0, z0), (r1, z1) in zip(inner, inner[1:]):
        if r1 < 1e-6:
            continue
        if z1 >= level:
            t = (level - z0) / (z1 - z0) if z1 != z0 else 0
            pts.append((max(r0 + (r1 - r0) * t - shrink, 0.001), level))
            break
        pts.append((max(r1 - shrink, 0.001), max(z1, inner[0][1] + shrink)))
    pts.append((0, level))
    return lathe(pts, segs)

def ribbon(r0, r1, z0, z1, a0, a1, n=12, off=0.0003):
    """Faixa fina na superfície (marcas de graduação, rótulo). Ângulos em graus."""
    bm = bmesh.new()
    bot, top = [], []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        bot.append(bm.verts.new(((r0 + off) * math.cos(a), (r0 + off) * math.sin(a), z0)))
        top.append(bm.verts.new(((r1 + off) * math.cos(a), (r1 + off) * math.sin(a), z1)))
    for i in range(n):
        bm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
    return bm

def merge(bms):
    out = bmesh.new()
    for b in bms:
        tmp = bpy.data.meshes.new("tmp")
        b.to_mesh(tmp)
        b.free()
        out.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    return out

def spout(bm, z_start, z_top, amount):
    """Puxa a borda para fora em +X formando um bico."""
    for v in bm.verts:
        if v.co.z > z_start:
            t = min((v.co.z - z_start) / (z_top - z_start), 1.0)
            ang = math.atan2(v.co.y, v.co.x)
            w = max(0.0, math.cos(ang)) ** 8
            r = math.hypot(v.co.x, v.co.y)
            if r > 1e-6:
                k = (r + amount * w * t * t) / r
                v.co.x *= k
                v.co.y *= k

def marks(r_of_z, levels, major_every, minor_half=10, major_half=20, h=0.0009):
    bms = []
    for i, z in enumerate(levels):
        half = major_half if i % major_every == 0 else minor_half
        bms.append(ribbon(r_of_z(z), r_of_z(z + h), z, z + h, -90 - half, -90 + half, n=8))
    return merge(bms)

def root(name, label, loc, grip_h, grip_d, rot_z=0):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.03
    col.objects.link(e)
    e.location = loc
    e.rotation_euler[2] = math.radians(rot_z)
    e["nome"] = label
    e["graspable"] = True
    e["grip_height"] = grip_h
    e["grip_diameter"] = grip_d
    return e

# Dispostas em semicírculo a 0,32 m do eixo da base (alcance confortável do braço em escala 0.6)
R = 0.32
def place(deg):
    a = math.radians(deg)
    return (R * math.cos(a), R * math.sin(a), 0)

# ---------------------------------------------------------------- 1. Béquer 250 mL
P = root("Vidraria_Bequer", "Béquer 250 mL", place(-80), 0.07, 0.068)
outer = [(0, 0), (0.031, 0), (0.0333, 0.0007), (0.034, 0.0025), (0.034, 0.0915),
         (0.0353, 0.093), (0.0350, 0.0948), (0.0336, 0.0952)]
inner = [(0, 0.003), (0.028, 0.003), (0.0305, 0.0032), (0.0322, 0.0055), (0.0322, 0.0942)]
bm = vessel(outer, inner)
spout(bm, 0.08, 0.0952, 0.007)
to_obj("Bequer_Vidro", bm, M_VIDRO, P)
to_obj("Bequer_Liquido", liquid(inner, 0.055), LIQ["azul"], P)
to_obj("Bequer_Graduacao", marks(lambda z: 0.034, [0.025 + 0.0075 * i for i in range(9)], 2), M_ESMALTE, P)

# ---------------------------------------------------------------- 2. Erlenmeyer 250 mL
P = root("Vidraria_Erlenmeyer", "Erlenmeyer 250 mL", place(-40), 0.128, 0.038)
outer = [(0, 0), (0.038, 0), (0.0415, 0.0015), (0.0428, 0.005), (0.0425, 0.009), (0.0205, 0.098),
         (0.0192, 0.104), (0.019, 0.11), (0.019, 0.148), (0.0208, 0.1495), (0.0208, 0.153),
         (0.0195, 0.1542)]
inner = [(0, 0.003), (0.0375, 0.003), (0.0405, 0.0055), (0.0405, 0.0095), (0.0187, 0.0975),
         (0.0174, 0.1035), (0.0172, 0.11), (0.0172, 0.1535)]
to_obj("Erlenmeyer_Vidro", vessel(outer, inner), M_VIDRO, P)
to_obj("Erlenmeyer_Liquido", liquid(inner, 0.042), LIQ["verde"], P)
cone_r = lambda z: 0.0425 - 0.022 * (z - 0.009) / 0.089
to_obj("Erlenmeyer_Graduacao", marks(cone_r, [0.03 + 0.012 * i for i in range(5)], 2), M_ESMALTE, P)

# ---------------------------------------------------------------- 3. Proveta 100 mL
P = root("Vidraria_Proveta", "Proveta 100 mL", place(0), 0.20, 0.036)
foot = lathe([(0, 0), (0.038, 0), (0.038, 0.0075), (0.036, 0.009), (0, 0.009)], segs=6)
to_obj("Proveta_Base", foot, M_VIDRO, P, angle=30)
outer = [(0, 0.008), (0.018, 0.008), (0.018, 0.245), (0.0193, 0.2465), (0.0193, 0.2495), (0.018, 0.2502)]
inner = [(0, 0.0125), (0.014, 0.0125), (0.0163, 0.014), (0.0163, 0.2495)]
bm = vessel(outer, inner)
spout(bm, 0.235, 0.2502, 0.006)
to_obj("Proveta_Vidro", bm, M_VIDRO, P)
to_obj("Proveta_Liquido", liquid(inner, 0.17), LIQ["laranja"], P)
to_obj("Proveta_Graduacao", marks(lambda z: 0.018, [0.03 + 0.01 * i for i in range(21)], 5, 7, 16), M_ESMALTE, P)

# ---------------------------------------------------------------- 4. Balão de fundo chato 500 mL
P = root("Vidraria_Balao", "Balão de fundo chato 500 mL", place(40), 0.14, 0.037)
outer = [(0, 0), (0.032, 0), (0.040, 0.003), (0.047, 0.012), (0.052, 0.03), (0.053, 0.045),
         (0.051, 0.062), (0.045, 0.078), (0.036, 0.091), (0.026, 0.100), (0.020, 0.107),
         (0.0185, 0.113), (0.0185, 0.165), (0.0203, 0.1665), (0.0203, 0.170), (0.019, 0.171)]
inner = [(0, 0.0032), (0.0315, 0.0032), (0.039, 0.0055), (0.0452, 0.0135), (0.0502, 0.0305),
         (0.0512, 0.045), (0.0492, 0.0615), (0.0432, 0.077), (0.034, 0.0895), (0.024, 0.099),
         (0.0182, 0.106), (0.0167, 0.113), (0.0167, 0.1702)]
to_obj("Balao_Vidro", vessel(outer, inner), M_VIDRO, P)
to_obj("Balao_Liquido", liquid(inner, 0.05), LIQ["roxo"], P)

# ---------------------------------------------------------------- 5. Frasco reagente âmbar 250 mL
P = root("Vidraria_Frasco", "Frasco reagente âmbar 250 mL", place(80), 0.065, 0.060)
outer = [(0, 0), (0.026, 0), (0.0295, 0.0025), (0.030, 0.007), (0.030, 0.082), (0.029, 0.090),
         (0.026, 0.097), (0.021, 0.102), (0.016, 0.105), (0.0145, 0.108), (0.0145, 0.124),
         (0.0137, 0.125)]
inner = [(0, 0.004), (0.025, 0.004), (0.028, 0.008), (0.028, 0.081), (0.027, 0.089), (0.024, 0.0955),
         (0.019, 0.1003), (0.0127, 0.106), (0.0127, 0.1245)]
to_obj("Frasco_Vidro", vessel(outer, inner), M_AMBAR, P)
cap = lathe([(0, 0.1075), (0.0168, 0.1075), (0.0175, 0.109), (0.0175, 0.111), (0.0175, 0.1305),
             (0.0175, 0.1325), (0.016, 0.134), (0, 0.134)], segs=48)
for v in cap.verts:  # estrias da tampa
    if 0.110 < v.co.z < 0.131:
        idx = round(math.atan2(v.co.y, v.co.x) / (2 * math.pi) * 48)
        if idx % 2:
            v.co.x *= 1.05
            v.co.y *= 1.05
to_obj("Frasco_Tampa", cap, M_TAMPA, P, angle=30)
to_obj("Frasco_Rotulo", ribbon(0.030, 0.030, 0.025, 0.068, -145, -35, n=24, off=0.0004), M_ROTULO, P)

# ---------------------------------------------------------------- preview
bpy.ops.mesh.primitive_plane_add(size=60)
floor = bpy.context.active_object
floor.name = "Chao"
floor.data.materials.append(make_mat("Chao", (0.35, 0.36, 0.38), 0, 0.5))
world = bpy.data.worlds.new("Mundo"); scene.world = world; world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = 0.12
tgt = bpy.data.objects.new("CamAlvo", None); col.objects.link(tgt); tgt.location = (0.12, -0.02, 0.07)
for nm, loc, energy in (("Key", (-0.6, -1.4, 1.6), 35), ("Rim", (1.4, 0.8, 1.2), 25)):
    ld = bpy.data.lights.new(nm, "AREA"); ld.energy = energy; ld.size = 1.2
    lo = bpy.data.objects.new(nm, ld); col.objects.link(lo); lo.location = loc
    tc = lo.constraints.new("TRACK_TO"); tc.target = tgt; tc.track_axis = "TRACK_NEGATIVE_Z"; tc.up_axis = "UP_Y"
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera")); col.objects.link(cam)
cam.data.lens = 50; scene.camera = cam
cam.location = tgt.location + Vector((-0.55, -1.0, 0.45)).normalized() * 1.95
tc = cam.constraints.new("TRACK_TO"); tc.target = tgt; tc.track_axis = "TRACK_NEGATIVE_Z"; tc.up_axis = "UP_Y"
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = eng; break
    except TypeError:
        pass
for attr, val in (("use_raytracing", True), ("taa_render_samples", 64)):
    try:
        setattr(scene.eevee, attr, val)
    except AttributeError:
        pass
try:
    scene.view_settings.view_transform = "Standard"
except TypeError:
    pass
scene.render.resolution_x, scene.render.resolution_y = 1200, 700
scene.render.filepath = os.path.join(IMG, "preview_vidrarias.png")
bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CENAS, "vidrarias.blend"))
for nm in ("Chao", "CamAlvo", "Key", "Rim", "Camera"):
    bpy.data.objects.remove(bpy.data.objects[nm], do_unlink=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, "vidrarias.glb"), export_format="GLB",
                          export_apply=True, export_yup=True, export_extras=True,
                          export_cameras=False, export_lights=False)
print("FACES", sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"))
print("OK")
