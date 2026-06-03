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
let grupoCaixas = null;          // THREE.Group com uma caixa+label por item
let elContainer = null;
let indiceSelecionado = null;    // índice do item destacado (null = nenhum)
let aoSelecionarCb = null;       // callback do app ao clicar numa caixa

// Registra o callback chamado com o índice clicado (ou null no clique em vazio)
export function onSelecionar(cb) {
  aoSelecionarCb = cb;
}

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

  // Seleção por clique (raycasting) — ignora arrastes do OrbitControls
  const ray = new THREE.Raycaster();
  let posDown = null;
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    posDown = [ev.clientX, ev.clientY];
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (!posDown) return;
    const moveu = Math.hypot(ev.clientX - posDown[0], ev.clientY - posDown[1]) > 5;
    posDown = null;
    if (moveu || !grupoCaixas || !aoSelecionarCb) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(grupoCaixas.children.filter((c) => c.visible), false);
    aoSelecionarCb(hits.length ? hits[0].object.userData.indice : null);
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

// Monta a cena para um novo resultado do solver
export function setCarga(itens, conteiner) {
  // Remove cena anterior
  if (grupoCaixas) {
    scene.remove(grupoCaixas);
    grupoCaixas.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  scene.children.filter((o) => o.userData.fixo).forEach((o) => scene.remove(o));

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

  // Caixas dos itens
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
    // O CSS2DRenderer reescreve element.style.display a cada frame a partir
    // de label.visible, então o controle precisa ser pela propriedade visible.
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

  // Câmera enquadrando o contêiner
  const alvo = new THREE.Vector3(cx / 2, cz / 2, cy / 2);
  controls.target.copy(alvo);
  camera.position.set(cx * 1.05, cz * 2.6, cy * 4.2);
  camera.lookAt(alvo);
  controls.update();
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
