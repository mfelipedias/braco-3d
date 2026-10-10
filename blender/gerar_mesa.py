# Gera a mesa (bancada de laboratório) e exporta mesa.glb.
# A origem do braço fica em (0, 0, ALTURA) — centro do tampo deslocado para a frente do braço.
# Depois importa braço + vidrarias sobre o tampo para renderizar o preview e salvar cena_completa.blend.
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

# Caminhos relativos ao repositório: GLB → web/models, .blend → blender/cenas, previews → docs/img
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODELS = os.path.join(ROOT, "web", "models")
CENAS = os.path.join(ROOT, "blender", "cenas")
IMG = os.path.join(ROOT, "docs", "img")
for _d in (MODELS, CENAS, IMG):
    os.makedirs(_d, exist_ok=True)
ALTURA = 0.75                  # altura da superfície do tampo
TAMPO = (0.90, 1.10, 0.03)     # x (direção do braço), y, espessura
CENTRO_X = 0.10                # tampo deslocado para o lado das vidrarias

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection

def make_mat(name, color, metallic=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*color, 1)
    return m

M_TAMPO = make_mat("Tampo", (0.20, 0.22, 0.24), 0.0, 0.35)
M_ACO = make_mat("Aco", (0.70, 0.72, 0.75), 0.85, 0.3)
M_PE = make_mat("Borracha", (0.02, 0.02, 0.02), 0.0, 0.7)

ROOT = bpy.data.objects.new("Mesa", None)
col.objects.link(ROOT)
ROOT["top_height"] = ALTURA

def rbox(name, size, center, mat, bevel=0.004, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, profile=0.5,
                    affect="EDGES", clamp_overlap=True)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(35))
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    o.parent = ROOT
    return o

def cyl(name, r, h, center, mat):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r, radius2=r, depth=h)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(35))
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    o.parent = ROOT
    return o

tx, ty, tt = TAMPO
rbox("Mesa_Tampo", TAMPO, (CENTRO_X, 0, ALTURA - tt / 2), M_TAMPO, bevel=0.006, segs=3)

# estrutura de aço: 4 pernas em tubo quadrado, travessas sob o tampo e prateleira inferior
LEG, INSET, FOOT = 0.045, 0.06, 0.02
lx, ly = tx / 2 - INSET, ty / 2 - INSET
leg_h = ALTURA - tt - FOOT
for i, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
    x, y = CENTRO_X + sx * lx, sy * ly
    rbox(f"Mesa_Perna_{i}", (LEG, LEG, leg_h), (x, y, FOOT + leg_h / 2), M_ACO, bevel=0.005)
    cyl(f"Mesa_Pe_{i}", 0.022, FOOT, (x, y, FOOT / 2), M_PE)
AP = 0.07  # altura das travessas
z_ap = ALTURA - tt - AP / 2
rbox("Mesa_Travessa_F", (2 * lx, 0.025, AP), (CENTRO_X, -ly, z_ap), M_ACO)
rbox("Mesa_Travessa_T", (2 * lx, 0.025, AP), (CENTRO_X, ly, z_ap), M_ACO)
rbox("Mesa_Travessa_E", (0.025, 2 * ly, AP), (CENTRO_X - lx, 0, z_ap), M_ACO)
rbox("Mesa_Travessa_D", (0.025, 2 * ly, AP), (CENTRO_X + lx, 0, z_ap), M_ACO)
rbox("Mesa_Prateleira", (2 * lx + LEG, 2 * ly + LEG, 0.018), (CENTRO_X, 0, 0.17), M_TAMPO, bevel=0.003)

# ---------------------------------------------------------------- exporta só a mesa
for o in bpy.data.objects:
    o.select_set(o == ROOT or o.parent == ROOT)
bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, "mesa.glb"), export_format="GLB", use_selection=True,
                          export_apply=True, export_yup=True, export_extras=True,
                          export_cameras=False, export_lights=False)

# ---------------------------------------------------------------- cena completa (preview)
for f in ("braco_robotico.glb", "vidrarias.glb"):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f))
    for o in set(bpy.data.objects) - before:
        if o.parent is None:
            o.location.z += ALTURA
arm = bpy.data.objects["RobotArm"]
for nm, axis, deg in (("J2_Ombro", 1, -25), ("J3_Cotovelo", 1, 85), ("J4_Punho", 1, 95),
                      ("J6_Dedo_D", 1, 18), ("J6_Dedo_E", 1, -18)):
    j = bpy.data.objects[nm]
    j.rotation_mode = "XYZ"
    j.rotation_euler[axis] = math.radians(deg)

bpy.ops.mesh.primitive_plane_add(size=60)
floor = bpy.context.active_object
floor.name = "Chao"
floor.data.materials.append(make_mat("Chao", (0.55, 0.55, 0.56), 0, 0.6))
world = bpy.data.worlds.new("Mundo"); scene.world = world; world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = 0.15
tgt = bpy.data.objects.new("CamAlvo", None); col.objects.link(tgt); tgt.location = (0.08, 0, ALTURA - 0.12)
for nm, loc, energy in (("Key", (-1.0, -2.0, 2.6), 70), ("Fill", (2.0, -0.8, 1.6), 25), ("Rim", (0.5, 2.0, 2.4), 40)):
    ld = bpy.data.lights.new(nm, "AREA"); ld.energy = energy; ld.size = 1.5
    lo = bpy.data.objects.new(nm, ld); col.objects.link(lo); lo.location = loc
    tc = lo.constraints.new("TRACK_TO"); tc.target = tgt; tc.track_axis = "TRACK_NEGATIVE_Z"; tc.up_axis = "UP_Y"
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera")); col.objects.link(cam)
cam.data.lens = 45; scene.camera = cam
cam.location = tgt.location + Vector((-0.35, -1.0, 0.45)).normalized() * 2.4
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
scene.render.resolution_x, scene.render.resolution_y = 1000, 1000
scene.render.filepath = os.path.join(IMG, "preview_mesa.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CENAS, "cena_completa.blend"))
print("OK")
