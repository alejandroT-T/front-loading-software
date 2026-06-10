// Cena Three.js: contêiner em wireframe + caixas dos itens com labels.
//
// Convenção de eixos — backend → Three.js (Y para cima):
//   backend X (comprimento) → three X
//   backend Y (lateral)     → three Z
//   backend Z (altura)      → three Y

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

// Paleta de cores distintas (estilo matplotlib Set2 estendida)
export const PALETA = [
  "#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f",
  "#e5c494", "#b3b3b3", "#80b1d3", "#fb8072", "#bebada", "#fdb462",
];

let renderer, labelRenderer, scene, camera, controls;
let grupoCaixas = null;          // THREE.Group com uma caixa+label por item (modo auto)
let elContainer = null;
let indiceSelecionado = null;    // índice do item destacado (null = nenhum)
let aoSelecionarCb = null;       // callback do app ao clicar numa caixa (auto)

// ── Modo manual ──
let grupoManual = null;          // THREE.Group das caixas posicionadas manualmente
const caixasManual = new Map();  // id -> THREE.Mesh
let modoManual = false;          // true no modo manual (habilita arrasto no piso)
let selManual = null;            // id da caixa manual selecionada
let aoSelManualCb = null;        // callback de seleção (modo manual)
let aoMoverCb = null;            // callback de arrasto: (id, st_x, st_y, st_z)

// Registra o callback chamado com o índice clicado (ou null no clique em vazio)
export function onSelecionar(cb) {
  aoSelecionarCb = cb;
}
export function onSelManual(cb) { aoSelManualCb = cb; }
export function onMoverManual(cb) { aoMoverCb = cb; }

export function initScene(container) {
  elContainer = container;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2129);

  camera = new THREE.PerspectiveCamera(50, 1, 1, 50000);
  camera.position.set(1500, 900, 1500);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // Renderer de labels HTML sobre o canvas
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Luzes
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(1200, 2000, 800);
  scene.add(dir);

  // Interação por ponteiro: clique = seleção; no modo manual, arrastar = mover no piso.
  const ray = new THREE.Raycaster();
  let posDown = null, alvoArr = null, arrastou = false;
  const planoArr = new THREE.Plane(), offsetArr = new THREE.Vector3(), pArr = new THREE.Vector3();

  const ndcDe = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    );
  };

  renderer.domElement.addEventListener("pointerdown", (ev) => {
    posDown = [ev.clientX, ev.clientY];
    arrastou = false; alvoArr = null;
    if (modoManual && grupoManual) {
      ray.setFromCamera(ndcDe(ev), camera);
      const hits = ray.intersectObjects(grupoManual.children, false);
      if (hits.length) {
        alvoArr = hits[0].object;
        controls.enabled = false;  // pegou uma caixa → trava o orbit (arrasta a caixa)
      }
    }
  });

  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (!modoManual || !alvoArr || posDown === null) return;
    if (!arrastou) {
      if (Math.hypot(ev.clientX - posDown[0], ev.clientY - posDown[1]) <= 5) return;
      arrastou = true;
      planoArr.set(new THREE.Vector3(0, 1, 0), -alvoArr.position.y);  // plano horizontal na altura da caixa
      ray.setFromCamera(ndcDe(ev), camera);
      ray.ray.intersectPlane(planoArr, pArr);
      offsetArr.copy(alvoArr.position).sub(pArr);  // ponto onde "pegou" na caixa
    }
    ray.setFromCamera(ndcDe(ev), camera);
    if (!ray.ray.intersectPlane(planoArr, pArr)) return;
    pArr.add(offsetArr);
    alvoArr.position.x = pArr.x;   // three X = backend X
    alvoArr.position.z = pArr.z;   // three Z = backend Y
    const d = alvoArr.userData;
    if (aoMoverCb) aoMoverCb(d.id, Math.round(pArr.x - d.dx / 2), Math.round(pArr.z - d.dy / 2), d.stz);
  });

  renderer.domElement.addEventListener("pointerup", (ev) => {
    const moveu = posDown && Math.hypot(ev.clientX - posDown[0], ev.clientY - posDown[1]) > 5;
    const foiArrasto = arrastou;
    controls.enabled = true;  // destrava o orbit ao soltar
    posDown = null; alvoArr = null; arrastou = false;
    if (foiArrasto) return;   // foi arrasto, não clique
    if (moveu) return;        // orbitou → não seleciona
    ray.setFromCamera(ndcDe(ev), camera);
    if (modoManual) {
      if (!grupoManual || !aoSelManualCb) return;
      const hits = ray.intersectObjects(grupoManual.children, false);
      aoSelManualCb(hits.length ? hits[0].object.userData.id : null);
    } else {
      if (!grupoCaixas || !aoSelecionarCb) return;
      const hits = ray.intersectObjects(grupoCaixas.children.filter((c) => c.visible), false);
      aoSelecionarCb(hits.length ? hits[0].object.userData.indice : null);
    }
  });

  redimensionar();
  new ResizeObserver(redimensionar).observe(container);

  (function animar() {
    requestAnimationFrame(animar);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  })();
}

function redimensionar() {
  const w = elContainer.clientWidth, h = elContainer.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
}

// Descarta geometrias/materiais de um objeto (e filhos) e remove os nós DOM dos
// labels (CSS2DObject) — o CSS2DRenderer não os remove sozinho ao tirar da cena.
function descartar(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
    if (o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);  // label CSS2D
  });
}

// Esvazia a cena por completo (caixas auto + manual + contêiner). Usada ao
// trocar de modo quando o novo modo ainda não tem nada para mostrar.
export function limparCena() {
  if (grupoCaixas) { scene.remove(grupoCaixas); descartar(grupoCaixas); grupoCaixas = null; }
  if (grupoManual) { scene.remove(grupoManual); descartar(grupoManual); grupoManual = null; caixasManual.clear(); }
  scene.children.filter((o) => o.userData.fixo).forEach((o) => scene.remove(o));
  indiceSelecionado = null;
  selManual = null;
}

// Limpa a cena (auto + manual) e desenha o contêiner vazio + enquadra a câmera.
// Compartilhado entre o modo automático (setCarga) e o manual (initManual).
function desenharConteiner(conteiner) {
  limparCena();

  const { cx, cy, cz } = conteiner;

  // Wireframe do contêiner (backend: cx × cy × cz → three: cx × cz × cy)
  const geoCont = new THREE.BoxGeometry(cx, cz, cy);
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(geoCont),
    new THREE.LineBasicMaterial({ color: 0x8b98a5 }),
  );
  wire.position.set(cx / 2, cz / 2, cy / 2);
  wire.userData.fixo = true;
  scene.add(wire);

  // Piso do contêiner
  const piso = new THREE.Mesh(
    new THREE.PlaneGeometry(cx, cy),
    new THREE.MeshBasicMaterial({ color: 0x2f3b47, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }),
  );
  piso.rotation.x = -Math.PI / 2;
  piso.position.set(cx / 2, 0, cy / 2);
  piso.userData.fixo = true;
  scene.add(piso);

  // Indicador do fundo (X=0)
  const eixos = new THREE.AxesHelper(150);
  eixos.userData.fixo = true;
  scene.add(eixos);

  // Câmera enquadrando o contêiner
  const alvo = new THREE.Vector3(cx / 2, cz / 2, cy / 2);
  controls.target.copy(alvo);
  camera.position.set(cx * 1.05, cz * 2.6, cy * 4.2);
  camera.lookAt(alvo);
  controls.update();
}

// Monta a cena (somente leitura) para um resultado do solver
export function setCarga(itens, conteiner) {
  modoManual = false;
  desenharConteiner(conteiner);

  grupoCaixas = new THREE.Group();
  itens.forEach((item, i) => {
    const cor = new THREE.Color(PALETA[i % PALETA.length]);
    const dz = item.end_z - item.st_z;

    const geo = new THREE.BoxGeometry(item.dx, dz, item.dy);
    const mat = new THREE.MeshLambertMaterial({ color: cor, transparent: true, opacity: 0.85 });
    const caixa = new THREE.Mesh(geo, mat);
    caixa.position.set(item.st_x + item.dx / 2, item.st_z + dz / 2, item.st_y + item.dy / 2);
    caixa.userData.indice = i;

    // Arestas pretas
    caixa.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x000000 }),
    ));

    // Label com o nome do item — oculto; só aparece no item selecionado.
    const div = document.createElement("div");
    div.className = "label-item";
    div.textContent = item.nome;
    const label = new CSS2DObject(div);
    label.visible = false;
    caixa.userData.label = label;
    caixa.add(label);

    grupoCaixas.add(caixa);
  });
  scene.add(grupoCaixas);
  indiceSelecionado = null;
}

// Mostra apenas os n primeiros itens (ordem de entrada no contêiner)
export function mostrarAte(n) {
  if (!grupoCaixas) return;
  grupoCaixas.children.forEach((caixa, i) => {
    caixa.visible = i < n;
  });
  aplicarSelecao();
}

// Destaca o item de índice idx (null = nenhum): opacidade cheia + brilho + label.
// Os demais ficam esmaecidos e com label oculto.
export function selecionarItem(idx) {
  indiceSelecionado = idx;
  aplicarSelecao();
}

function aplicarSelecao() {
  if (!grupoCaixas) return;
  const haSelecao = indiceSelecionado !== null;
  grupoCaixas.children.forEach((caixa, i) => {
    const selecionado = i === indiceSelecionado;
    caixa.material.opacity = !haSelecao ? 0.85 : (selecionado ? 1.0 : 0.35);
    caixa.material.emissive.setHex(selecionado ? 0x2f2f2f : 0x000000);
    // Só o item selecionado (e visível na cena) exibe o label
    caixa.userData.label.visible = selecionado && caixa.visible;
  });
}

// ═══ Modo manual ═════════════════════════════════════════════════════════════
const COR_INVALIDA = new THREE.Color(0xf85149);

// Entra no modo manual: limpa a cena e desenha o contêiner vazio
export function initManual(conteiner) {
  modoManual = true;
  desenharConteiner(conteiner);
  grupoManual = new THREE.Group();
  scene.add(grupoManual);
  caixasManual.clear();
  selManual = null;
}

// Adiciona uma caixa posicionável. Coords em backend (cm): st_x/st_y/st_z.
export function adicionarCaixaManual({ id, nome, dx, dy, dz, stx = 0, sty = 0, stz = 0, indiceCor = 0 }) {
  if (!grupoManual) return;
  const corBase = new THREE.Color(PALETA[indiceCor % PALETA.length]);
  const geo = new THREE.BoxGeometry(dx, dz, dy);
  const mat = new THREE.MeshLambertMaterial({ color: corBase.clone(), transparent: true, opacity: 0.85 });
  const caixa = new THREE.Mesh(geo, mat);
  caixa.position.set(stx + dx / 2, stz + dz / 2, sty + dy / 2);
  caixa.userData = { id, dx, dy, dz, stz, corBase };

  caixa.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x000000 }),
  ));

  const div = document.createElement("div");
  div.className = "label-item";
  div.textContent = nome;
  const label = new CSS2DObject(div);
  label.visible = false;
  caixa.userData.label = label;
  caixa.add(label);

  caixasManual.set(id, caixa);
  grupoManual.add(caixa);
}

// Reposiciona a caixa (backend cm). Atualiza st_z guardado para o arrasto.
export function moverCaixaManual(id, stx, sty, stz) {
  const c = caixasManual.get(id);
  if (!c) return;
  const d = c.userData;
  d.stz = stz;
  c.position.set(stx + d.dx / 2, stz + d.dz / 2, sty + d.dy / 2);
}

// Rotaciona a caixa (qualquer troca entre dx/dy/dz): recria a geometria com as
// novas dimensões. O app deve chamar moverCaixaManual em seguida p/ manter st_*.
export function redimensionarCaixaManual(id, dx, dy, dz) {
  const c = caixasManual.get(id);
  if (!c) return;
  const d = c.userData;
  d.dx = dx; d.dy = dy; d.dz = dz;
  const geo = new THREE.BoxGeometry(dx, dz, dy);
  c.geometry.dispose();
  c.geometry = geo;
  const arestas = c.children.find((o) => o.isLineSegments);
  if (arestas) { arestas.geometry.dispose(); arestas.geometry = new THREE.EdgesGeometry(geo); }
}

export function removerCaixaManual(id) {
  const c = caixasManual.get(id);
  if (!c) return;
  grupoManual.remove(c);
  descartar(c);
  caixasManual.delete(id);
  if (selManual === id) selManual = null;
}

// Destaca a caixa de id (null = nenhuma): brilho + label
export function selecionarCaixaManual(id) {
  selManual = id;
  caixasManual.forEach((c, key) => {
    const sel = key === id;
    c.material.emissive.setHex(sel ? 0x2f2f2f : 0x000000);
    c.userData.label.visible = sel;
  });
}

// Pinta de vermelho as caixas cujo id está no Set `ids` (sobreposição/fora); o resto volta à cor base
export function marcarInvalidos(ids) {
  caixasManual.forEach((c, key) => {
    c.material.color.copy(ids.has(key) ? COR_INVALIDA : c.userData.corBase);
  });
}
