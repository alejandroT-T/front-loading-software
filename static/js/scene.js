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
let setasSel = null;             // THREE.Group com as 6 setas da caixa selecionada
let aoSetaCb = null;             // callback de clique numa seta: ({eixo, sinal})

// Registra o callback chamado com o índice clicado (ou null no clique em vazio)
export function onSelecionar(cb) {
  aoSelecionarCb = cb;
}
export function onSelManual(cb) { aoSelManualCb = cb; }
export function onMoverManual(cb) { aoMoverCb = cb; }
export function onSeta(cb) { aoSetaCb = cb; }

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
  let posDown = null, alvoArr = null, arrastou = false, cliqueConsumido = false;
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
      const hitsSeta = setasSel ? ray.intersectObjects(setasSel.children, false) : [];
      const hitsCx = ray.intersectObjects(grupoManual.children, false);
      // Seta de deslizamento ganha se for o alvo mais próximo da câmera
      if (hitsSeta.length && (!hitsCx.length || hitsSeta[0].distance <= hitsCx[0].distance)) {
        if (aoSetaCb) aoSetaCb(hitsSeta[0].object.userData.seta);
        cliqueConsumido = true;
        posDown = null;
        controls.enabled = false;  // não orbita a partir do clique na seta (volta no pointerup)
        return;
      }
      if (hitsCx.length) {
        alvoArr = hitsCx[0].object;
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
    if (cliqueConsumido) { cliqueConsumido = false; return; }  // clique foi numa seta
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
    if (o.material) {
      if (o.material.map) o.material.map.dispose();  // textura (sprites numerados do PDF)
      o.material.dispose();
    }
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
  setasSel = null;  // já descartado junto com a caixa (é filho dela)
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

// ── Setas de deslizamento (6 sentidos) na caixa selecionada ──
// Clicar numa seta desliza a caixa naquele sentido até o primeiro obstáculo
// (a lógica fica no app, via onSeta). As setas são filhas do mesh da caixa,
// então acompanham o movimento sozinhas; só precisam reposicionar no resize.
const DIRECOES_SETA = [
  { eixo: "x", sinal: +1 }, { eixo: "x", sinal: -1 },
  { eixo: "y", sinal: +1 }, { eixo: "y", sinal: -1 },
  { eixo: "z", sinal: +1 }, { eixo: "z", sinal: -1 },
];

function removerSetas() {
  if (!setasSel) return;
  if (setasSel.parent) setasSel.parent.remove(setasSel);
  descartar(setasSel);
  setasSel = null;
}

function criarSetas(caixa) {
  removerSetas();
  setasSel = new THREE.Group();
  for (const seta of DIRECOES_SETA) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(11, 30, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd92f }),
    );
    cone.userData.seta = seta;
    setasSel.add(cone);
  }
  caixa.add(setasSel);
  posicionarSetas();
}

// Posiciona cada seta no centro da face correspondente, apontando para fora.
// Eixos locais do mesh: x = backend X (dx), y = backend Z (dz), z = backend Y (dy).
function posicionarSetas() {
  if (!setasSel || !setasSel.parent) return;
  const d = setasSel.parent.userData;
  const off = 15 + 15;  // afastamento da face + meia altura do cone
  for (const cone of setasSel.children) {
    const { eixo, sinal } = cone.userData.seta;
    cone.rotation.set(0, 0, 0);  // cone padrão aponta +Y local
    if (eixo === "x") {
      cone.position.set(sinal * (d.dx / 2 + off), 0, 0);
      cone.rotation.z = sinal > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else if (eixo === "y") {
      cone.position.set(0, 0, sinal * (d.dy / 2 + off));
      cone.rotation.x = sinal > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      cone.position.set(0, sinal * (d.dz / 2 + off), 0);
      if (sinal < 0) cone.rotation.x = Math.PI;
    }
  }
}

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
  if (setasSel && setasSel.parent === c) posicionarSetas();  // acompanha as novas faces
}

export function removerCaixaManual(id) {
  const c = caixasManual.get(id);
  if (!c) return;
  if (setasSel && setasSel.parent === c) setasSel = null;  // descartado junto (é filho)
  grupoManual.remove(c);
  descartar(c);
  caixasManual.delete(id);
  if (selManual === id) selManual = null;
}

// Destaca a caixa de id (null = nenhuma): brilho + label + setas de deslizamento
export function selecionarCaixaManual(id) {
  selManual = id;
  caixasManual.forEach((c, key) => {
    const sel = key === id;
    c.material.emissive.setHex(sel ? 0x2f2f2f : 0x000000);
    c.userData.label.visible = sel;
  });
  const caixa = id != null ? caixasManual.get(id) : null;
  if (caixa) criarSetas(caixa);
  else removerSetas();
}

// Pinta de vermelho as caixas cujo id está no Set `ids` (sobreposição/fora); o resto volta à cor base
export function marcarInvalidos(ids) {
  caixasManual.forEach((c, key) => {
    c.material.color.copy(ids.has(key) ? COR_INVALIDA : c.userData.corBase);
  });
}

// ═══ Captura de etapas (PDF de montagem) ═════════════════════════════════════
// Renderiza fora da tela o carregamento acumulado etapa por etapa e devolve uma
// imagem JPEG (dataURL) por etapa. As caixas da etapa aparecem destacadas e com
// um marcador numerado (sequência de montagem); as anteriores ficam esmaecidas.
// Não toca na cena principal — funciona em qualquer modo, sem piscar a tela.

// Paleta do GUIA DE MARCA SOHOME (principal + auxiliar) usada só nas imagens do
// PDF; a cena na tela continua com a PALETA padrão (cores mais distintas).
export const PALETA_MARCA = [
  "#84867b", "#997d5c", "#909d9c", "#878264", "#494038", "#c5c0b3", "#484c40",
];

// Marcador circular com o número de sequência, desenhado num canvas
function spriteNumero(n) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = "#211f1e";  // preto da marca
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 64px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), 64, 68);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), depthTest: false,
  }));
  return sp;
}

// caixas: [{nome, stx, sty, stz, dx, dy, dz, idxCor}] já na ordem de montagem
export function capturarEtapas(conteiner, caixas, porEtapa = 3, largura = 1280, altura = 720) {
  const { cx, cy, cz } = conteiner;
  const cena = new THREE.Scene();
  cena.background = new THREE.Color(0xffffff);  // fundo branco para impressão
  cena.add(new THREE.AmbientLight(0xffffff, 0.95));
  const luz = new THREE.DirectionalLight(0xffffff, 1.1);
  luz.position.set(cx * 0.8, cz * 3, cy * 2.5);
  cena.add(luz);

  const geoCont = new THREE.BoxGeometry(cx, cz, cy);
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(geoCont),
    new THREE.LineBasicMaterial({ color: 0x84867b }),  // ash da marca
  );
  wire.position.set(cx / 2, cz / 2, cy / 2);
  cena.add(wire);
  geoCont.dispose();
  const piso = new THREE.Mesh(
    new THREE.PlaneGeometry(cx, cy),
    new THREE.MeshBasicMaterial({ color: 0xdcd8d3, side: THREE.DoubleSide }),  // bege claro da marca
  );
  piso.rotation.x = -Math.PI / 2;
  piso.position.set(cx / 2, -0.5, cy / 2);
  cena.add(piso);

  const cam = new THREE.PerspectiveCamera(45, largura / altura, 1, 50000);
  const alvo = new THREE.Vector3(cx / 2, cz / 2, cy / 2);
  cam.position.set(cx * 1.05, cz * 2.4, cy * 3.8);
  cam.lookAt(alvo);

  const meshes = caixas.map((b, i) => {
    const geo = new THREE.BoxGeometry(b.dx, b.dz, b.dy);
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(PALETA_MARCA[(b.idxCor ?? i) % PALETA_MARCA.length]),
      transparent: true, opacity: 0.95,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(b.stx + b.dx / 2, b.stz + b.dz / 2, b.sty + b.dy / 2);
    m.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x211f1e }),
    ));
    const sp = spriteNumero(i + 1);
    sp.position.set(0, b.dz / 2 + 24, 0);
    sp.scale.set(36, 36, 1);
    m.add(sp);
    m.userData.sprite = sp;
    cena.add(m);
    return m;
  });

  const rend = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  rend.setPixelRatio(1);
  rend.setSize(largura, altura);

  const fotos = [];
  for (let ini = 0; ini < meshes.length; ini += porEtapa) {
    const fim = Math.min(ini + porEtapa, meshes.length);
    meshes.forEach((m, i) => {
      m.visible = i < fim;
      const nova = i >= ini && i < fim;
      m.material.opacity = nova ? 0.95 : 0.3;
      m.userData.sprite.visible = nova;
    });
    rend.render(cena, cam);
    fotos.push(rend.domElement.toDataURL("image/jpeg", 0.9));
  }

  descartar(cena);
  rend.dispose();
  rend.forceContextLoss();  // libera o contexto WebGL temporário na hora
  return fotos;
}
