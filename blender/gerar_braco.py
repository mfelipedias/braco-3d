# Gera o braço robótico (estilo da referência) com juntas articuláveis e exporta GLB.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

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
def make_mat(name, color, metallic=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*color, 1)
    return m

M_YELLOW = make_mat("Amarelo", (0.78, 0.52, 0.0), 0.15, 0.32)
M_BLACK = make_mat("Preto", (0.012, 0.012, 0.012), 0.0, 0.45)
M_DARK = make_mat("CinzaEscuro", (0.045, 0.045, 0.05), 0.3, 0.35)
M_METAL = make_mat("Metal", (0.6, 0.6, 0.62), 1.0, 0.3)

# ---------------------------------------------------------------- helpers
def empty(name, parent, loc, size=0.06, **props):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = size
    col.objects.link(e)
    e.parent = parent
    e.location = loc
    for k, v in props.items():
        e[k] = v
    return e

def to_obj(name, bm, mat, parent, loc=(0, 0, 0), angle=35):
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
    o.location = loc
    return o

def bevel_sharp(bm, offset, segs=3, min_angle=50):
    edges = [e for e in bm.edges if e.is_manifold and e.calc_face_angle(0) > math.radians(min_angle)]
    if edges and offset > 0:
        bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=segs, profile=0.5,
                        affect="EDGES", clamp_overlap=True)

def cyl(r, depth, axis="Z", center=(0, 0, 0), segs=48, bevel=0.003, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r, radius2=r if r2 is None else r2, depth=depth)
    bevel_sharp(bm, bevel)
    if axis == "Y":
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "X"))
    elif axis == "X":
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm

def rbox(size, center=(0, 0, 0), bevel=0.006, segs=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, profile=0.5,
                    affect="EDGES", clamp_overlap=True)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm

def extrude_profile(pts_xz, y0, thick, bevel=0.003):
    """Perfil 2D no plano XZ extrudado em Y (de y0 a y0+thick)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y0, z)) for x, z in pts_xz]
    f = bm.faces.new(vs)
    ret = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, thick, 0)), verts=nv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bevel_sharp(bm, bevel, segs=3, min_angle=60)
    return bm

def stadium_pts(r1, r2, length, n=24):
    pts = []
    for i in range(n + 1):  # semicírculo inferior
        a = -math.pi * i / n
        pts.append((r1 * math.cos(a), r1 * math.sin(a)))
    for i in range(n + 1):  # semicírculo superior
        a = math.pi - math.pi * i / n
        pts.append((r2 * math.cos(a), length + r2 * math.sin(a)))
    return pts

# ---------------------------------------------------------------- hierarquia
ROOT = empty("RobotArm", None, (0, 0, 0), 0.15)

# Base fixa
to_obj("Base_Flange", cyl(0.17, 0.025, center=(0, 0, 0.0125), segs=64, bevel=0.004), M_BLACK, ROOT)
to_obj("Base_Corpo", cyl(0.135, 0.17, center=(0, 0, 0.11), segs=64, bevel=0.006), M_BLACK, ROOT)
to_obj("Base_Topo", cyl(0.125, 0.01, center=(0, 0, 0.2), segs=64, bevel=0.002), M_DARK, ROOT)
bm = bmesh.new()
for i in range(8):
    a = 2 * math.pi * i / 8 + math.pi / 8
    b2 = cyl(0.009, 0.006, center=(0.152 * math.cos(a), 0.152 * math.sin(a), 0.028), segs=16, bevel=0.0015)
    tmp = bpy.data.meshes.new("t"); b2.to_mesh(tmp); b2.free(); bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
to_obj("Base_Parafusos", bm, M_METAL, ROOT)

# J1 - giro da base (eixo Z do Blender = Y no glTF/three.js)
J1 = empty("J1_Base", ROOT, (0, 0, 0.205), joint="revolute", axis_blender="Z", axis_threejs="y",
           min_deg=-180, max_deg=180)
to_obj("Torre_Disco", cyl(0.12, 0.03, center=(0, 0, 0.015), segs=64, bevel=0.004), M_BLACK, J1)
to_obj("Torre_Corpo", rbox((0.13, 0.115, 0.09), center=(0, 0.0, 0.075), bevel=0.015), M_BLACK, J1)
to_obj("Ombro_Motor", cyl(0.068, 0.115, axis="Y", center=(0, 0.0, 0.13), bevel=0.005), M_BLACK, J1)

# J2 - ombro (eixo Y do Blender = -Z no three.js)
J2 = empty("J2_Ombro", J1, (0, 0, 0.13), joint="revolute", axis_blender="Y", axis_threejs="-z",
           min_deg=-90, max_deg=90)
L_UP = 0.36
to_obj("Braco_Elo", extrude_profile(stadium_pts(0.066, 0.056, L_UP), -0.1025, 0.045, bevel=0.005), M_YELLOW, J2)
to_obj("Ombro_Tampa", cyl(0.05, 0.022, axis="Y", center=(0, -0.112, 0), bevel=0.004), M_BLACK, J2)
to_obj("Cotovelo_Tampa", cyl(0.045, 0.022, axis="Y", center=(0, -0.112, L_UP), bevel=0.004), M_BLACK, J2)
to_obj("Cotovelo_Motor", cyl(0.036, 0.026, axis="Y", center=(0, -0.046, L_UP), bevel=0.002), M_DARK, J2)

# J3 - cotovelo
J3 = empty("J3_Cotovelo", J2, (0, 0, L_UP), joint="revolute", axis_blender="Y", axis_threejs="-z",
           min_deg=-150, max_deg=150)
L_FA = 0.30
to_obj("Antebraco_Elo", extrude_profile(stadium_pts(0.05, 0.042, L_FA), -0.035, 0.07, bevel=0.005), M_YELLOW, J3)
for side, nm in ((-1, "Antebraco_Painel_F"), (1, "Antebraco_Painel_T")):
    to_obj(nm, rbox((0.068, 0.006, 0.19), center=(0, side * 0.036, 0.155), bevel=0.0025), M_DARK, J3)

# J4 - flexão do punho
J4 = empty("J4_Punho", J3, (0, 0, L_FA), joint="revolute", axis_blender="Y", axis_threejs="-z",
           min_deg=-120, max_deg=120)
for side in (-1, 1):
    to_obj(f"Punho_Garfo_{'F' if side < 0 else 'T'}",
           extrude_profile(stadium_pts(0.036, 0.034, 0.05), side * 0.042 - 0.006, 0.012, bevel=0.002), M_YELLOW, J4)
    to_obj(f"Punho_Pino_{'F' if side < 0 else 'T'}",
           cyl(0.022, 0.008, axis="Y", center=(0, side * 0.052, 0), bevel=0.002), M_BLACK, J4)
to_obj("Punho_Bloco", rbox((0.07, 0.096, 0.04), center=(0, 0, 0.066), bevel=0.008), M_YELLOW, J4)
to_obj("Punho_Servo", rbox((0.02, 0.05, 0.03), center=(0.042, 0, 0.066), bevel=0.004), M_BLACK, J4)

# J5 - rotação do punho (eixo Z local = Y no three.js)
J5 = empty("J5_Rotacao", J4, (0, 0, 0.086), joint="revolute", axis_blender="Z", axis_threejs="y",
           min_deg=-180, max_deg=180)
to_obj("Garra_Flange", cyl(0.032, 0.01, center=(0, 0, 0.005), bevel=0.002), M_BLACK, J5)
to_obj("Garra_Palma", rbox((0.095, 0.045, 0.036), center=(0, 0, 0.028), bevel=0.006), M_BLACK, J5)
bm = bmesh.new()
for sx in (-1, 1):
    for sy in (-1, 1):
        b2 = cyl(0.0065, 0.004, axis="Y", center=(sx * 0.024, sy * 0.0245, 0.04), segs=16, bevel=0.001)
        tmp = bpy.data.meshes.new("t"); b2.to_mesh(tmp); b2.free(); bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
to_obj("Garra_Pinos", bm, M_YELLOW, J5)

FINGER = [(0.008, -0.010), (0.022, 0.000), (0.030, 0.030), (0.031, 0.065), (0.024, 0.100),
          (0.010, 0.126), (-0.004, 0.136), (-0.010, 0.128), (-0.003, 0.106), (0.003, 0.080),
          (0.003, 0.052), (-0.003, 0.028), (-0.010, 0.010), (-0.010, -0.006)]
# Dedos: giram no eixo Y do Blender (-Z no three.js). Positivo abre no direito, negativo abre no esquerdo.
for sx, nm in ((1, "J6_Dedo_D"), (-1, "J6_Dedo_E")):
    J = empty(nm, J5, (sx * 0.024, 0, 0.04), 0.03, joint="revolute", axis_blender="Y", axis_threejs="-z",
              min_deg=(-5 if sx > 0 else -40), max_deg=(40 if sx > 0 else 5))
    pts = [(sx * x, z) for x, z in FINGER]
    to_obj(nm.replace("J6_", "") + "_Garra", extrude_profile(pts, -0.0145, 0.029, bevel=0.0025), M_BLACK, J)
    # almofada interna (mais escura/fosca)
    pad = [(sx * x, z) for x, z in [(-0.010, 0.128), (-0.003, 0.106), (0.003, 0.080), (0.003, 0.052),
                                    (-0.0015, 0.052), (-0.0045, 0.080), (-0.0105, 0.106), (-0.0165, 0.124)]]
    to_obj(nm.replace("J6_", "") + "_Almofada", extrude_profile(pad, -0.012, 0.024, bevel=0.001), M_DARK, J)

# garra maior, como na referência
G = 1.35
for o in list(bpy.data.objects):
    if o.parent in (J5, bpy.data.objects["J6_Dedo_D"], bpy.data.objects["J6_Dedo_E"]) and o.type == "MESH":
        o.data.transform(Matrix.Scale(G, 4))
for n in ("J6_Dedo_D", "J6_Dedo_E"):
    bpy.data.objects[n].location *= G

JOINTS = {"J1_Base": J1, "J2_Ombro": J2, "J3_Cotovelo": J3, "J4_Punho": J4, "J5_Rotacao": J5,
          "J6_Dedo_D": bpy.data.objects["J6_Dedo_D"], "J6_Dedo_E": bpy.data.objects["J6_Dedo_E"]}
AXIS = {"J1_Base": 2, "J5_Rotacao": 2}

def pose(**deg):
    for n, j in JOINTS.items():
        j.rotation_euler = (0, 0, 0)
        j.rotation_euler[AXIS.get(n, 1)] = math.radians(deg.get(n, 0))

# Escala final do braço, aplicada na geometria e nas posições das juntas (nenhum nó fica com scale ≠ 1).
# As medidas acima são do braço em tamanho 1:1; 0.6 deixa ele proporcional às vidrarias em tamanho real.
ESCALA = 0.6
for o in bpy.data.objects:
    if o.type == "MESH":
        o.data.transform(Matrix.Scale(ESCALA, 4))
    o.location *= ESCALA

# ---------------------------------------------------------------- cena de render (só preview)
render_objs = []
bpy.ops.mesh.primitive_plane_add(size=60)
floor = bpy.context.active_object; floor.name = "Chao"
floor.data.materials.append(make_mat("Chao", (0.95, 0.95, 0.95), 0, 0.6)); render_objs.append(floor)
world = bpy.data.worlds.new("Mundo"); scene.world = world; world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = 0.3
for nm, loc, energy, size in (("Key", (-1.2, -1.6, 2.2), 600, 1.5), ("Fill", (1.8, -0.8, 1.2), 200, 2.0),
                              ("Rim", (0.5, 1.8, 2.0), 250, 1.5)):
    ld = bpy.data.lights.new(nm, "AREA"); ld.energy = energy; ld.size = size
    lo = bpy.data.objects.new(nm, ld); col.objects.link(lo); lo.location = loc
    tc = lo.constraints.new("TRACK_TO"); tc.target = J2; tc.track_axis = "TRACK_NEGATIVE_Z"; tc.up_axis = "UP_Y"
    render_objs.append(lo)
tgt = bpy.data.objects.new("CamAlvo", None); col.objects.link(tgt); tgt.location = Vector((0.05, 0, 0.45)) * ESCALA
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera")); col.objects.link(cam)
cam.data.lens = 50; scene.camera = cam
tc = cam.constraints.new("TRACK_TO"); tc.target = tgt; tc.track_axis = "TRACK_NEGATIVE_Z"; tc.up_axis = "UP_Y"
render_objs += [tgt, cam]

for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = eng; break
    except TypeError:
        pass
print("ENGINE", scene.render.engine)
try:
    scene.view_settings.view_transform = "Standard"
except TypeError:
    pass
if scene.render.engine == "CYCLES":
    scene.cycles.samples = 64
else:
    scene.eevee.taa_render_samples = 64
scene.render.resolution_x, scene.render.resolution_y = 800, 1000
scene.render.image_settings.file_format = "PNG"

def render(path, cam_dir, dist=2.3):
    d = Vector(cam_dir).normalized()
    cam.location = tgt.location + d * dist * ESCALA
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

pose(J2_Ombro=-25, J3_Cotovelo=85, J4_Punho=95, J6_Dedo_D=18, J6_Dedo_E=-18)
render(os.path.join(IMG, "preview_pose_referencia.png"), (-0.25, -1, 0.3))
pose(J1_Base=35, J2_Ombro=20, J3_Cotovelo=40, J4_Punho=60, J5_Rotacao=45, J6_Dedo_D=30, J6_Dedo_E=-30)
render(os.path.join(IMG, "preview_pose_2.png"), (0.6, -1, 0.5), 2.5)
pose()
tgt.location = Vector((0, 0, 0.6)) * ESCALA
render(os.path.join(IMG, "preview_pose_zero.png"), (-0.5, -1, 0.25), 2.8)

# ---------------------------------------------------------------- salvar / exportar
pose(J2_Ombro=-25, J3_Cotovelo=85, J4_Punho=95, J6_Dedo_D=18, J6_Dedo_E=-18)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CENAS, "braco_robotico.blend"))

pose()  # GLB exportado com todas as juntas em 0 (braço reto para cima)
for o in render_objs:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, "braco_robotico.glb"), export_format="GLB",
                          export_apply=True, export_yup=True, export_extras=True,
                          export_cameras=False, export_lights=False)

tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
print("OBJETOS", len(bpy.data.objects), "FACES", tris)
print("OK")
