# Arquitetura e funcionamento

A aplicação é estática (HTML + CSS + módulos ES), sem etapa de build. As bibliotecas vêm do jsDelivr
via *import map* (`three`, `three/addons/`, `three-mesh-bvh`); TensorFlow.js e o pacote do Teachable Machine
só são baixados quando a câmera é ligada ou um modelo é carregado.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `web/js/config.js` | juntas (nó do GLB, limites, eixo), poses, teclas e gestos padrão |
| `web/js/ui.js` | aviso de status, abas, painéis recolhíveis, tela de carregamento, diálogos |
| `web/js/app.js` | cena three.js, cinemática, planejamento da pegada, colisões, teclado e gestos |
| `web/css/app.css` | visual (tokens em `:root`) e layout responsivo |

## Cena

- `mesa.glb` fica na origem; o objeto `Mesa` traz `top_height` (altura do tampo).
- O braço e as vidrarias ficam num grupo `bench` apoiado no tampo, no mesmo referencial da base do braço.
- Fundo da página em CSS (o renderer é transparente); sombras numa `ShadowMaterial` no chão.

## Juntas e cinemática

Os ângulos seguem a convenção do Blender, em graus. O eixo Y do Blender vira −Z no three.js, por isso
as juntas de flexão aplicam `rotation.z = -ângulo`.

A geometria (alturas, comprimentos L1/L2, posição dos dedos) é lida dos próprios nós do GLB em
`readArmGeometry`, então mudar a escala em `gerar_braco.py` não exige mudar o JavaScript.

**Cinemática inversa** (`ik`): planar, no plano vertical definido pela base. Dado o ponto de pega
(distância *r* ao eixo e altura *h*) e a direção da garra, resolve ombro, cotovelo e punho com
“cotovelo para cima”; sem direção fixa, testa inclinações de 90° a 150° e fica com a primeira que respeita os limites.

**Pegada automática** (`plan` + `pick`): recolhe o braço, gira a base, desce acima da peça, aproxima com a garra
aberta (recuo calculado pelo diâmetro da vidraria), fecha, prende a peça ao punho e levanta.
`devolver` faz o caminho inverso.

**Movimento cartesiano** (`moveCartesian`): usado pelos gestos Subir/Descer; recalcula a IK mantendo a
inclinação atual da garra.

## Colisões

Cada malha recebe uma `MeshBVH`. A cada movimento (`moveTo`) o intervalo é dividido em passos de 1,5° para não
atravessar as paredes finas do vidro; na primeira colisão, uma busca binária para o braço encostado no obstáculo.

- Partes móveis: tudo abaixo de `J1_Base` mais a vidraria presa.
- Obstáculos: tampo da mesa, vidrarias paradas (malhas com material `Vidro*`, `Liquido*` ou `Plastico*`) e o chão.

**Pegada manual** (`moveGripper`): cada dedo fecha até encostar (`fingerContact`). A peça só é presa se os dois
dedos tocarem a mesma vidraria, com ângulos parecidos e em lados opostos do eixo dela (`opposite`).
Ao abrir a garra (`release`) a vidraria volta a ficar em pé e cai até o tampo, se estiver sobre a mesa e houver espaço.

## Teclado

`keymap` guarda para cada junta a tecla de diminuir, a de aumentar e o passo. Usa `KeyboardEvent.code`
(posição física) e guarda o caractere digitado para exibir o nome certo em qualquer layout (ex.: ABNT2).
Teclas seguradas repetem a cada 50 ms, independente do FPS.

## Gestos

1. A webcam (224×224, espelhada) é classificada a cada 80 ms.
2. As probabilidades passam por uma média móvel exponencial (fator 0,5).
3. Um gesto só fica ativo após 300 ms estável acima do limiar; a ação se repete a cada 100 ms.

Modelo do usuário: `.zip` descompactado no navegador com fflate e aberto com `tmImage.loadFromFiles`.
Nada sai do navegador.

## Dados salvos no navegador (`localStorage`)

| Chave | Conteúdo |
|---|---|
| `braco3d.teclas.v1` | teclas e passos |
| `braco3d.gestos.v1` | ação por gesto, limiar, passo cartesiano, liga/desliga |
| `braco3d.ui.v1` | aba ativa, painéis recolhidos, ajuda já vista |
