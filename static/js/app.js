// Estado da aplicação + ligação entre UI, API e cena 3D

import { listarConteineres, carregarItens, iniciarSolver, aguardarResultado } from "./api.js";
import {
  initScene, setCarga, mostrarAte, PALETA, onSelecionar, selecionarItem, limparCena,
  initManual, adicionarCaixaManual, moverCaixaManual, redimensionarCaixaManual,
  removerCaixaManual, selecionarCaixaManual, marcarInvalidos, onSelManual, onMoverManual, onSeta,
  capturarEtapas, PALETA_MARCA,
} from "./scene.js";

const $ = (id) => document.getElementById(id);

// Estado de um editor manipulável (manual e híbrido têm cada um o seu,
// para que trocar de modo não misture os carregamentos)
function novoEditor() {
  return {
    catalogo: [],   // [{nome, x, y, z, peso_kg, volume_cm3, idxCor}] da planilha
    cont: null,     // contêiner ativo (cx/cy/cz/peso_max_kg/vol_max_m3)
    manual: { posicionadas: [], selId: null, invalid: new Set(), undo: [], redo: [] },
    arquivo: null,  // nome da planilha carregada (usado no nome do CSV exportado)
  };
}

const estado = {
  modo: null,        // "auto" | "manual" | "hibrido" (null até o setModo inicial)
  conteineres: [],   // catálogo vindo da API
  // Modo automático
  resultado: null,   // resposta do solver
  arquivoAuto: null, // nome da planilha que gerou estado.resultado
  visiveis: 0,       // quantos itens estão posicionados na cena
  selecionado: null, // índice do item destacado (null = nenhum)
  executando: false,
  // Editores manipuláveis — um por modo; o ativo é espelhado em catalogo/contManual/manual
  editorAtivo: "manual",
  editores: { manual: novoEditor(), hibrido: novoEditor() },
  catalogo: [],
  contManual: null,
  manual: null,
  arquivoManual: null,
};
// Espelha o editor inicial nas referências ativas
{
  const e = estado.editores[estado.editorAtivo];
  estado.catalogo = e.catalogo;
  estado.contManual = e.cont;
  estado.manual = e.manual;
  estado.arquivoManual = e.arquivo;
}

// ═══ Inicialização ══════════════════════════════════════════════════════════

initScene($("viewport"));
carregarConteineres();

// ═══ Modo de operação ════════════════════════════════════════════════════════
// Cada modo mantém seu próprio estado e sua própria cena 3D: alternar entre
// eles não mistura nada — serve justamente para comparar os carregamentos.

const MODOS = {
  auto:    "Rodar o solver: empilhamento e empacotamento automático.",
  manual:  "✋ Envie o formato das caixas e posicione manualmente, caixa por caixa.",
  hibrido: "🔀 Rodar o solver e depois manipular/mover as cargas livremente.",
};

function setModo(modo) {
  if (modo === estado.modo) return;

  // Guarda o editor do modo anterior e ativa o do novo — manual e híbrido são
  // independentes, e o resultado do automático fica intacto em estado.resultado.
  estado.editores[estado.editorAtivo] =
    { catalogo: estado.catalogo, cont: estado.contManual, manual: estado.manual,
      arquivo: estado.arquivoManual };
  const auto = modo === "auto", manual = modo === "manual", hibrido = modo === "hibrido";
  const editavel = manual || hibrido;  // ambos usam o editor manipulável (paleta/posicionadas/edição)
  if (editavel) {
    estado.editorAtivo = modo;
    const e = estado.editores[modo];
    estado.catalogo = e.catalogo;
    estado.contManual = e.cont;
    estado.manual = e.manual;
    estado.arquivoManual = e.arquivo;
  }
  estado.modo = modo;

  document.querySelectorAll(".modo-btn").forEach((b) =>
    b.classList.toggle("ativo", b.dataset.modo === modo));
  $("modo-dica").textContent = MODOS[modo];

  // Cards de ação (painel esquerdo)
  $("card-executar").hidden = !auto;
  $("card-manual").hidden = !manual;
  $("card-hibrido").hidden = !hibrido;
  // Barra de controles (centro)
  $("controles").hidden = !auto;
  $("controles-manual").hidden = !editavel;
  // Painel direito
  $("painel-auto").hidden = editavel;
  $("painel-manual").hidden = !editavel;

  // Cada modo mantém sua própria cena: reconstrói o visual do modo que entrou
  if (auto) reconstruirCenaAuto();
  else reconstruirCenaManual();
  atualizarBotaoExportar();
}

document.querySelectorAll(".modo-btn").forEach((b) =>
  b.addEventListener("click", () => setModo(b.dataset.modo)));
setModo("auto");

// Clique na caixa 3D: seleciona/desseleciona; clique no vazio limpa a seleção
onSelecionar((i) => {
  setSelecionado(i === null || i === estado.selecionado ? null : i);
});

async function carregarConteineres() {
  try {
    estado.conteineres = await listarConteineres();
    const sel = $("conteiner");
    sel.innerHTML = "";
    for (const c of estado.conteineres) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.nome;
      sel.appendChild(opt);
    }
    const opt = document.createElement("option");
    opt.value = "personalizado";
    opt.textContent = "Personalizado…";
    sel.appendChild(opt);
    sel.value = "40hc"; // padrão do backend
    atualizarInfoConteiner();
  } catch (e) {
    $("status-solver").textContent = `⚠ ${e.message}`;
    $("status-solver").className = "status-solver erro";
  }
}

function atualizarInfoConteiner() {
  const id = $("conteiner").value;
  const personalizado = id === "personalizado";
  $("campos-personalizado").hidden = !personalizado;
  if (personalizado) {
    $("info-conteiner").textContent = "";
    return;
  }
  const c = estado.conteineres.find((x) => x.id === id);
  if (c) {
    $("info-conteiner").innerHTML =
      `📐 ${c.cx} × ${c.cy} × ${c.cz} cm<br>` +
      `⚖️ Peso máx: ${fmt(c.peso_max_kg)} kg<br>` +
      `📦 Volume máx: ${fmt(c.vol_max_m3)} m³`;
  }
}

// ═══ Upload + execução do solver ════════════════════════════════════════════

$("arquivo").addEventListener("change", () => {
  const f = $("arquivo").files[0];
  $("arquivo-nome").textContent = f ? `📄 ${f.name}` : "Clique para escolher a planilha…";
  $("file-drop").classList.toggle("tem-arquivo", !!f);
  $("btn-executar").disabled = !f;
  $("btn-carregar").disabled = !f;
  $("btn-hibrido").disabled = !f;
});

$("conteiner").addEventListener("change", atualizarInfoConteiner);

$("btn-executar").addEventListener("click", async () => {
  if (estado.executando) return;
  const arquivo = $("arquivo").files[0];
  if (!arquivo) return;

  const fd = new FormData();
  fd.append("arquivo", arquivo);
  fd.append("conteiner", $("conteiner").value);
  fd.append("tempo", $("tempo-solver").value || 90);

  if ($("conteiner").value === "personalizado") {
    const campos = { cx: "p-cx", cy: "p-cy", cz: "p-cz", peso_max_kg: "p-peso", vol_max_m3: "p-vol" };
    for (const [chave, id] of Object.entries(campos)) {
      const v = $(id).value;
      if (!v) {
        setStatus("⚠ Preencha todas as dimensões do contêiner personalizado.", "erro");
        return;
      }
      fd.append(chave, v);
    }
  }

  estado.executando = true;
  $("btn-executar").disabled = true;
  setStatus("⏳ Enviando dados…");

  try {
    const { job_id } = await iniciarSolver(fd);
    const resultado = await aguardarResultado(job_id, (seg, fase) => {
      setStatus(`⏳ ${fase || "Executando solver…"} — ${seg}s`);
    });
    estado.resultado = resultado;
    estado.arquivoAuto = arquivo.name;
    setStatus("✅ Solução encontrada!", "ok");
    apresentarResultado(resultado);
  } catch (e) {
    setStatus(`❌ ${e.message}`, "erro");
  } finally {
    estado.executando = false;
    $("btn-executar").disabled = !$("arquivo").files[0];
  }
});

function setStatus(msg, classe = "") {
  const el = $("status-solver");
  el.textContent = msg;
  el.className = `status-solver ${classe}`;
}

// ═══ Apresentação do resultado ══════════════════════════════════════════════

function apresentarResultado(r) {
  // Cena 3D — começa com todos os itens posicionados, sem seleção.
  // Se o usuário trocou de modo enquanto o solver rodava, não desenha agora:
  // o resultado fica em estado.resultado e reaparece ao voltar pro automático.
  estado.selecionado = null;
  estado.visiveis = r.itens.length;
  if (estado.modo === "auto") {
    reconstruirCenaAuto();
    atualizarBotaoExportar();
  }
}

// Estatísticas gerais + itens não carregados (painel esquerdo-inferior)
function renderInfoAuto(r) {
  const e = r.estatisticas;
  const pesoPct = (100 * e.peso_total_kg / e.peso_max_kg).toFixed(1);
  const volPct = (100 * e.volume_total_cm3 / e.volume_max_cm3).toFixed(1);
  const avPct = (100 * e.avanco_cm / e.comprimento_cm).toFixed(1);
  let stats =
    `📊 Itens carregados: ${e.itens_carregados}/${e.itens_total}\n` +
    `⚖️ Peso total: ${fmt(e.peso_total_kg, 1)} kg / ${fmt(e.peso_max_kg)} kg (${pesoPct}%)\n` +
    `📦 Volume total: ${fmt(e.volume_total_cm3)} cm³ / ${fmt(e.volume_max_cm3)} cm³ (${volPct}%)\n` +
    `📏 Avanço no contêiner: ${e.avanco_cm} cm de ${e.comprimento_cm} cm (${avPct}%)`;
  if (e.pesados_total > 0) {
    stats += `\n⚠️ Itens >80 kg no chão: ${e.pesados_no_chao}/${e.pesados_total}`;
  }
  $("stats").textContent = stats;
  $("stats").classList.remove("vazio");

  // Itens não carregados
  const box = $("nao-carregados-box");
  if (r.nao_carregados.length) {
    box.hidden = false;
    $("nao-carregados-qtd").textContent = r.nao_carregados.length;
    $("nao-carregados").innerHTML = r.nao_carregados
      .map((i) => `<li>${i.nome} — ${fmt(i.peso_kg, 1)} kg | ${fmt(i.volume_cm3)} cm³</li>`)
      .join("");
  } else {
    box.hidden = true;
  }
}

// ═══ Reconstrução da cena por modo ═══════════════════════════════════════════
// Cada modo guarda seu próprio estado; ao alternar, a cena 3D e os painéis são
// remontados a partir do estado do modo que entrou (permite comparar os modos).

function reconstruirCenaAuto() {
  if (!estado.resultado) {
    limparCena();
    $("viewport-vazio").textContent = "A visualização 3D aparecerá aqui após executar o solver.";
    $("viewport-vazio").style.display = "";
    $("contador").textContent = "0 / 0";
    $("stats").className = "stats vazio";
    $("stats").textContent = "Execute o solver para ver as estatísticas.";
    $("nao-carregados-box").hidden = true;
    renderizarPainelDireito();
    return;
  }
  const r = estado.resultado;
  $("viewport-vazio").style.display = "none";
  setCarga(r.itens, r.conteiner);
  renderInfoAuto(r);
  const sel = estado.selecionado;
  setVisiveis(estado.visiveis);
  setSelecionado(sel !== null && sel < estado.visiveis ? sel : null);
}

function reconstruirCenaManual() {
  $("nao-carregados-box").hidden = true;
  if (!estado.contManual) {
    limparCena();
    $("viewport-vazio").textContent = estado.modo === "hibrido"
      ? "Rode o solver para editar o resultado aqui."
      : "Carregue as caixas da planilha para começar a posicionar.";
    $("viewport-vazio").style.display = "";
    $("stats").className = "stats vazio";
    $("stats").textContent = "Carregue as caixas para ver as estatísticas.";
    renderManual();
    return;
  }
  const c = estado.contManual;
  $("viewport-vazio").style.display = "none";
  initManual({ cx: c.cx, cy: c.cy, cz: c.cz });
  for (const p of estado.manual.posicionadas) {
    adicionarCaixaManual({ id: p.id, nome: p.id, dx: p.dx, dy: p.dy, dz: p.dz,
                           stx: p.stx, sty: p.sty, stz: p.stz, indiceCor: p.idxCor,
                           ...pesVisual(p) });
  }
  selecionarCaixaManual(estado.manual.selId);
  $("stats").className = "stats";
  recalcManual();   // recomputa inválidos, pinta as caixas e atualiza as stats
  renderManual();
}

// ═══ Controle interativo (←  →  Todos  Limpar) ═════════════════════════════

function setVisiveis(n) {
  if (!estado.resultado) return;
  const total = estado.resultado.itens.length;
  estado.visiveis = Math.max(0, Math.min(n, total));
  // Item selecionado saiu da cena → limpa a seleção
  if (estado.selecionado !== null && estado.selecionado >= estado.visiveis) {
    estado.selecionado = null;
    selecionarItem(null);
  }
  mostrarAte(estado.visiveis);
  $("contador").textContent = `${estado.visiveis} / ${total}`;
  renderizarPainelDireito();
}

// Destaca um item (na cena e no painel direito); null limpa a seleção
function setSelecionado(i) {
  estado.selecionado = i;
  selecionarItem(i);
  renderizarPainelDireito();
}

$("btn-next").addEventListener("click", () => setVisiveis(estado.visiveis + 1));
$("btn-prev").addEventListener("click", () => setVisiveis(estado.visiveis - 1));
$("btn-todos").addEventListener("click", () => setVisiveis(Infinity));
$("btn-limpar").addEventListener("click", () => setVisiveis(0));

document.addEventListener("keydown", (ev) => {
  // Ctrl+Z desfaz e Ctrl+Shift+Z (ou Ctrl+Y) refaz a última ação do editor
  // (modos manual e híbrido) — inclusive com o foco nos campos X/Y/Z, já que
  // eles também movem a caixa
  if ((ev.ctrlKey || ev.metaKey) && (estado.modo === "manual" || estado.modo === "hibrido")) {
    const k = ev.key.toLowerCase();
    if (k === "z" || k === "y") {
      ev.preventDefault();
      if (k === "y" || ev.shiftKey) refazer();
      else desfazer();
      return;
    }
  }
  if (estado.modo !== "auto") return;
  if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT") return;
  if (ev.key === "ArrowRight") setVisiveis(estado.visiveis + 1);
  if (ev.key === "ArrowLeft") setVisiveis(estado.visiveis - 1);
});

// ═══ Painel direito: detalhes item a item ═══════════════════════════════════

function renderizarPainelDireito() {
  const el = $("lista-itens");
  if (!estado.resultado || estado.visiveis === 0) {
    el.className = "lista-itens vazio";
    el.textContent = "Nenhum item posicionado.";
    return;
  }

  el.className = "lista-itens";
  const visiveis = estado.resultado.itens.slice(0, estado.visiveis);
  el.innerHTML = visiveis.map((it, i) => {
    const cor = PALETA[i % PALETA.length];
    const atual = i === estado.visiveis - 1 ? " atual" : "";
    const sel = i === estado.selecionado ? " selecionado" : "";
    const tipo = rotuloTipo(it.tipo_caixa);
    return `
      <div class="item-card${atual}${sel}" data-indice="${i}" style="--cor-item:${cor}">
        <div class="item-titulo">${it.sequencia}º ITEM A ENTRAR: 📦 ${it.nome}</div>
        ${tipo ? `🏷️ Tipo: ${tipo}<br>` : ""}
        📍 Comprimento (X): ${it.st_x} cm ➡️ ${it.end_x} cm<br>
        ↔️ Lateral (Y): ${it.st_y} cm — ${it.end_y} cm<br>
        ↕️ Altura (Z): ${it.st_z} cm — ${it.end_z} cm<br>
        📐 Encaixe: ${it.dx}×${it.dy}×${it.dz} cm | Girado: ${it.girado ? "Sim (90°)" : "Não"}<br>
        ⚖️ Peso: ${fmt(it.peso_kg, 1)} kg
      </div>`;
  }).join("");

  // Clique no card seleciona/desseleciona o item
  const cards = el.querySelectorAll(".item-card");
  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const i = Number(card.dataset.indice);
      setSelecionado(i === estado.selecionado ? null : i);
    });
  });

  // Scroll: acompanha o item selecionado; sem seleção, o último a entrar
  const alvo = estado.selecionado !== null ? cards[estado.selecionado] : cards[cards.length - 1];
  if (alvo) alvo.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ═══ Modo manual ═════════════════════════════════════════════════════════════
// Carrega o catálogo de caixas da planilha e o usuário posiciona cada uma
// (arrastar no piso + campos X/Y/Z + girar). Regras "livres com avisos":
// sobrepor/sair do contêiner é permitido, mas a caixa fica vermelha e conta como problema.

function conteinerAtual() {
  const id = $("conteiner").value;
  if (id === "personalizado") {
    const num = (x) => Number($(x).value);
    return { nome: "Personalizado", cx: num("p-cx"), cy: num("p-cy"), cz: num("p-cz"),
             peso_max_kg: num("p-peso"), vol_max_m3: num("p-vol") };
  }
  return estado.conteineres.find((c) => c.id === id) || null;
}

function setStatusManual(msg, classe = "") {
  const el = $("status-manual");
  el.textContent = msg;
  el.className = `status-solver ${classe}`;
}

$("btn-carregar").addEventListener("click", async () => {
  const arquivo = $("arquivo").files[0];
  if (!arquivo) { setStatusManual("⚠ Escolha a planilha.", "erro"); return; }
  const cont = conteinerAtual();
  if (!cont || !cont.cx) { setStatusManual("⚠ Defina o contêiner.", "erro"); return; }

  const fd = new FormData();
  fd.append("arquivo", arquivo);
  try {
    setStatusManual("⏳ Lendo planilha…");
    const itens = await carregarItens(fd);
    const ed = novoEditor();
    ed.catalogo = itens.map((it, i) => ({ ...it, idxCor: i }));
    ed.cont = cont;
    ed.arquivo = arquivo.name;
    if (estado.modo === "manual") {
      estado.catalogo = ed.catalogo;
      estado.contManual = ed.cont;
      estado.manual = ed.manual;
      estado.arquivoManual = ed.arquivo;
      reconstruirCenaManual();
    } else {
      // usuário trocou de modo durante a leitura: guarda no slot do manual
      estado.editores.manual = ed;
    }
    setStatusManual(`✅ ${itens.length} caixas no catálogo.`, "ok");
  } catch (e) {
    setStatusManual(`❌ ${e.message}`, "erro");
  }
});

function regSel() {
  const id = estado.manual.selId;
  return id == null ? null : estado.manual.posicionadas.find((p) => p.id === id);
}

// Pés da caixa para DESENHO (o vão é só visual; nada é encaixado nele):
// usa os pés do catálogo, correndo no eixo onde está o comprimento original
// ("x" normal, "y" girada no plano). Caixa tombada (altura original fora do
// eixo Z) ou item sem pés → desenha maciça.
function pesVisual(p) {
  const o = p.item || {};
  if (!o.pes || (o.z != null && p.dz !== o.z)) return { pes: null, eixoPes: "x" };
  return { pes: o.pes, eixoPes: o.x == null || p.dx === o.x ? "x" : "y" };
}

// ── Desfazer / Refazer (Ctrl+Z / Ctrl+Shift+Z) ──
// Pilhas de snapshots por editor (manual e híbrido têm cada um as suas, dentro
// de estado.manual.undo/redo). Um snapshot é guardado ANTES de cada ação que
// altera as caixas; gestos contínuos (arrasto, digitação de coordenada) são
// agrupados pelo par grupo+janela de tempo, então o Ctrl+Z desfaz o gesto
// inteiro de uma vez. Qualquer ação nova descarta o que havia para refazer.
const UNDO_MAX = 50;
let ultimoUndo = { grupo: null, t: 0 };

function snapshotAtual() {
  return {
    posicionadas: estado.manual.posicionadas.map((p) => ({ ...p })),
    selId: estado.manual.selId,
  };
}

function pushUndo(grupo = null) {
  if (!estado.manual) return;
  estado.manual.redo.length = 0;  // ação nova invalida o refazer
  const agora = Date.now();
  if (grupo && ultimoUndo.grupo === grupo && agora - ultimoUndo.t < 1500) {
    ultimoUndo.t = agora;  // mesmo gesto: mantém só o snapshot do início
    return;
  }
  ultimoUndo = { grupo, t: agora };
  const u = estado.manual.undo;
  u.push(snapshotAtual());
  if (u.length > UNDO_MAX) u.shift();
}

function restaurarSnapshot(snap, msg) {
  ultimoUndo = { grupo: null, t: 0 };  // próximo gesto abre novo snapshot
  estado.manual.posicionadas = snap.posicionadas;
  estado.manual.selId =
    snap.selId != null && snap.posicionadas.some((p) => p.id === snap.selId) ? snap.selId : null;
  reconstruirCenaManual();
  const status = estado.modo === "hibrido" ? setStatusHibrido : setStatusManual;
  status(msg, "ok");
}

function desfazer() {
  if (!estado.manual || !estado.manual.undo.length) return;
  estado.manual.redo.push(snapshotAtual());
  restaurarSnapshot(estado.manual.undo.pop(), "↩ Última ação desfeita (Ctrl+Z).");
}

function refazer() {
  if (!estado.manual || !estado.manual.redo.length) return;
  estado.manual.undo.push(snapshotAtual());
  restaurarSnapshot(estado.manual.redo.pop(), "↪ Ação refeita (Ctrl+Shift+Z).");
}

// Coloca uma caixa do catálogo no contêiner. Nasce no piso (Y=0,Z=0) logo após
// a última no eixo X, para não sobrepor por padrão; o usuário ajusta depois.
function placeBox(nome) {
  const item = estado.catalogo.find((c) => c.nome === nome);
  if (!item) return;
  pushUndo();
  const stx = estado.manual.posicionadas.reduce((m, p) => Math.max(m, p.stx + p.dx), 0);
  const reg = { id: nome, item, stx, sty: 0, stz: 0,
                dx: item.x, dy: item.y, dz: item.z, girado: false, idxCor: item.idxCor };
  estado.manual.posicionadas.push(reg);
  adicionarCaixaManual({ id: nome, nome, dx: reg.dx, dy: reg.dy, dz: reg.dz,
                         stx, sty: 0, stz: 0, indiceCor: reg.idxCor, ...pesVisual(reg) });
  selecionarManualId(nome);
  recalcManual();
  renderManual();
}

function selecionarManualId(id) {
  estado.manual.selId = id;
  selecionarCaixaManual(id);
  renderManual();
}

function sobrepoe(a, b) {
  return !(a.stx + a.dx <= b.stx || b.stx + b.dx <= a.stx ||
           a.sty + a.dy <= b.sty || b.sty + b.dy <= a.sty ||
           a.stz + a.dz <= b.stz || b.stz + b.dz <= a.stz);
}

// Recalcula sobreposições e fora-dos-limites; pinta inválidos e atualiza stats
function recalcManual() {
  const c = estado.contManual, P = estado.manual.posicionadas;
  const inval = new Set();
  for (const p of P) {
    if (p.stx < 0 || p.sty < 0 || p.stz < 0 ||
        p.stx + p.dx > c.cx || p.sty + p.dy > c.cy || p.stz + p.dz > c.cz) inval.add(p.id);
  }
  for (let i = 0; i < P.length; i++)
    for (let j = i + 1; j < P.length; j++)
      if (sobrepoe(P[i], P[j])) { inval.add(P[i].id); inval.add(P[j].id); }
  estado.manual.invalid = inval;
  marcarInvalidos(inval);
  atualizarStatsManual();
}

function atualizarStatsManual() {
  const c = estado.contManual, P = estado.manual.posicionadas;
  if (!c) return;
  const vol = P.reduce((s, p) => s + p.item.volume_cm3, 0);
  const peso = P.reduce((s, p) => s + p.item.peso_kg, 0);
  const volMax = c.vol_max_m3 * 1_000_000;
  const nInval = estado.manual.invalid.size;
  let s = `📦 Posicionadas: ${P.length}/${estado.catalogo.length}\n` +
          `⚖️ Peso: ${fmt(peso, 1)} kg / ${fmt(c.peso_max_kg)} kg\n` +
          `📦 Volume: ${fmt(vol)} cm³ / ${fmt(volMax)} cm³ (${volMax ? (100 * vol / volMax).toFixed(1) : "0.0"}%)`;
  if (nInval) s += `\n⚠️ ${nInval} caixa(s) com problema (sobreposição ou fora do contêiner).`;
  $("stats").textContent = s;
  $("stats").classList.remove("vazio");
}

// Render das listas (paleta + posicionadas) e do editor
function renderManual() {
  atualizarBotaoExportar();
  const P = estado.manual.posicionadas;
  const colocadas = new Set(P.map((p) => p.id));

  const pal = estado.catalogo.filter((c) => !colocadas.has(c.nome));
  const elPal = $("manual-palette");
  elPal.className = "lista-itens";
  if (pal.length) {
    elPal.innerHTML = pal.map((c) => {
      const tipo = rotuloTipo(c.tipo_caixa);
      return `<div class="pal-item" data-nome="${c.nome}" style="--cor-item:${PALETA[c.idxCor % PALETA.length]}">
        📦 ${c.nome}<br><small>${c.x}×${c.y}×${c.z} cm | ${fmt(c.peso_kg, 1)} kg${tipo ? ` | ${tipo}` : ""}</small>
      </div>`;
    }).join("");
    elPal.querySelectorAll(".pal-item").forEach((el) =>
      el.addEventListener("click", () => placeBox(el.dataset.nome)));
  } else {
    elPal.innerHTML = estado.catalogo.length
      ? "<div class='vazio-msg'>Todas as caixas posicionadas.</div>"
      : "<div class='vazio-msg'>Carregue as caixas da planilha.</div>";
  }

  const elPl = $("manual-placed");
  elPl.className = "lista-itens";
  if (P.length) {
    elPl.innerHTML = P.map((p) => {
      const inval = estado.manual.invalid.has(p.id) ? " invalido" : "";
      const sel = p.id === estado.manual.selId;
      const rot = p.girado ? " (rotacionada)" : "";
      const cor = PALETA[p.idxCor % PALETA.length];
      const tipo = rotuloTipo(p.item && p.item.tipo_caixa);
      // Caixa selecionada: card expandido com os detalhes (posição, tamanho, peso)
      if (sel) {
        return `<div class="placed-item selecionado${inval}" data-id="${p.id}" style="--cor-item:${cor}">
          <div class="item-titulo">📦 ${p.id}</div>
          ${tipo ? `🏷️ Tipo: ${tipo}<br>` : ""}
          📍 Posição: <span class="pos-sel">X ${p.stx} | Y ${p.sty} | Z ${p.stz} cm</span><br>
          📐 Tamanho: ${p.dx}×${p.dy}×${p.dz} cm${rot}<br>
          ⚖️ Peso: ${fmt(p.item.peso_kg, 1)} kg
        </div>`;
      }
      return `<div class="placed-item${inval}" data-id="${p.id}" style="--cor-item:${cor}">
        📦 ${p.id}<br><small>X${p.stx} Y${p.sty} Z${p.stz} | ${p.dx}×${p.dy}×${p.dz} cm${rot} | ${fmt(p.item.peso_kg, 1)} kg${tipo ? ` | ${tipo}` : ""}</small>
      </div>`;
    }).join("");
    elPl.querySelectorAll(".placed-item").forEach((el) =>
      el.addEventListener("click", () => selecionarManualId(el.dataset.id)));
    // Direciona a lista para a caixa selecionada (clicada na cena 3D ou na lista)
    const cardSel = elPl.querySelector(".placed-item.selecionado");
    if (cardSel) cardSel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } else {
    elPl.innerHTML = "<div class='vazio-msg'>Nenhuma caixa posicionada.</div>";
  }

  atualizarEditorCampos();
}

function atualizarEditorCampos() {
  const reg = regSel();
  $("manual-editor").hidden = !reg;
  $("manual-hint").hidden = !!reg;
  if (reg) {
    $("m-sel-nome").textContent = reg.id;
    $("m-x").value = reg.stx;
    $("m-y").value = reg.sty;
    $("m-z").value = reg.stz;
  }
}

// Atualiza só a posição no card expandido da caixa selecionada (sem re-render
// da lista — usado no arrasto e na edição de X/Y/Z, que disparam a cada evento)
function atualizarCardSel() {
  const reg = regSel();
  if (!reg) return;
  const pos = $("manual-placed").querySelector(".placed-item.selecionado .pos-sel");
  if (pos) pos.textContent = `X ${reg.stx} | Y ${reg.sty} | Z ${reg.stz} cm`;
}

function aplicarCampos() {
  const reg = regSel();
  if (!reg) return;
  pushUndo(`campos:${reg.id}`);  // digitação contínua = um snapshot só
  reg.stx = Math.round(Number($("m-x").value) || 0);
  reg.sty = Math.round(Number($("m-y").value) || 0);
  reg.stz = Math.round(Number($("m-z").value) || 0);
  moverCaixaManual(reg.id, reg.stx, reg.sty, reg.stz);
  recalcManual();
  atualizarCardSel();
}
["m-x", "m-y", "m-z"].forEach((id) => $(id).addEventListener("input", aplicarCampos));

// Rotação da caixa selecionada: troca duas das dimensões (90° em torno de um eixo).
// X↔Y gira no plano; X↔Z e Y↔Z tombam a caixa. Vale para manual e híbrido —
// é só manipulação visual, o solver não é afetado.
function rotacionarSel(a, b) {
  const reg = regSel();
  if (!reg) return;
  pushUndo();
  [reg[a], reg[b]] = [reg[b], reg[a]];
  reg.girado = reg.item.x != null
    ? (reg.dx !== reg.item.x || reg.dy !== reg.item.y || reg.dz !== reg.item.z)
    : !reg.girado;  // item sem dims no catálogo (híbrido): só alterna a marca
  const pv = pesVisual(reg);
  redimensionarCaixaManual(reg.id, reg.dx, reg.dy, reg.dz, pv.pes, pv.eixoPes);
  moverCaixaManual(reg.id, reg.stx, reg.sty, reg.stz);  // mantém st_* após trocar as dimensões
  recalcManual();
  renderManual();
}
$("btn-girar").addEventListener("click", () => rotacionarSel("dx", "dy"));
$("btn-girar-xz").addEventListener("click", () => rotacionarSel("dx", "dz"));
$("btn-girar-yz").addEventListener("click", () => rotacionarSel("dy", "dz"));

$("btn-remover").addEventListener("click", () => {
  const reg = regSel();
  if (!reg) return;
  pushUndo();
  removerCaixaManual(reg.id);
  estado.manual.posicionadas = estado.manual.posicionadas.filter((p) => p.id !== reg.id);
  estado.manual.selId = null;
  recalcManual();
  renderManual();
});

// Desliza a caixa selecionada no sentido da seta clicada até encostar no
// primeiro obstáculo — ou até a parede/piso/teto do contêiner se o caminho
// estiver livre. Só bloqueia caixa cuja projeção cruza a da selecionada nos
// outros dois eixos; caixas já sobrepostas não bloqueiam (modo livre com avisos).
function deslizarSel(eixo, sinal) {
  const reg = regSel();
  if (!reg || !estado.contManual) return;
  const ST = { x: "stx", y: "sty", z: "stz" }, DIM = { x: "dx", y: "dy", z: "dz" };
  const st = ST[eixo], dim = DIM[eixo];
  const limite = { x: estado.contManual.cx, y: estado.contManual.cy, z: estado.contManual.cz }[eixo];
  const outros = ["x", "y", "z"].filter((e) => e !== eixo);
  const cruza = (p) => outros.every((e) =>
    p[ST[e]] < reg[ST[e]] + reg[DIM[e]] && reg[ST[e]] < p[ST[e]] + p[DIM[e]]);

  let novo;
  if (sinal < 0) {
    novo = 0;  // limite do contêiner (fundo/lateral/piso)
    for (const p of estado.manual.posicionadas) {
      if (p.id === reg.id || !cruza(p)) continue;
      const borda = p[st] + p[dim];
      if (borda <= reg[st] && borda > novo) novo = borda;
    }
  } else {
    novo = limite - reg[dim];
    for (const p of estado.manual.posicionadas) {
      if (p.id === reg.id || !cruza(p)) continue;
      if (p[st] >= reg[st] + reg[dim] && p[st] - reg[dim] < novo) novo = p[st] - reg[dim];
    }
  }
  if (novo === reg[st]) return;
  pushUndo();
  reg[st] = novo;
  moverCaixaManual(reg.id, reg.stx, reg.sty, reg.stz);
  recalcManual();
  atualizarEditorCampos();
  atualizarCardSel();
}

// Callbacks da cena (modo manual)
onSeta(({ eixo, sinal }) => deslizarSel(eixo, sinal));
onSelManual((id) => selecionarManualId(id));
onMoverManual((id, stx, sty, stz) => {
  const reg = estado.manual.posicionadas.find((p) => p.id === id);
  if (!reg) return;
  pushUndo(`mover:${id}`);  // arrasto contínuo = um snapshot só (posição inicial)
  if (estado.manual.selId !== id) selecionarManualId(id);  // seleciona ao começar a arrastar
  reg.stx = stx; reg.sty = sty; reg.stz = stz;
  recalcManual();
  atualizarEditorCampos();
  atualizarCardSel();
});

// ═══ Modo híbrido ════════════════════════════════════════════════════════════
// Roda o solver (como o automático) e abre o resultado no MESMO editor do modo
// manual: os itens posicionados pelo solver viram caixas arrastáveis e os itens
// não carregados entram na paleta "A posicionar" para o usuário completar à mão.

function setStatusHibrido(msg, classe = "") {
  const el = $("status-hibrido");
  el.textContent = msg;
  el.className = `status-solver ${classe}`;
}

$("btn-hibrido").addEventListener("click", async () => {
  if (estado.executando) return;
  const arquivo = $("arquivo").files[0];
  if (!arquivo) { setStatusHibrido("⚠ Escolha a planilha.", "erro"); return; }
  const contSel = conteinerAtual();
  if (!contSel || !contSel.cx) { setStatusHibrido("⚠ Defina o contêiner.", "erro"); return; }

  const fd = new FormData();
  fd.append("arquivo", arquivo);
  fd.append("conteiner", $("conteiner").value);
  if ($("conteiner").value === "personalizado") {
    const campos = { cx: "p-cx", cy: "p-cy", cz: "p-cz", peso_max_kg: "p-peso", vol_max_m3: "p-vol" };
    for (const [k, id] of Object.entries(campos)) {
      const v = $(id).value;
      if (!v) { setStatusHibrido("⚠ Preencha as dimensões do contêiner personalizado.", "erro"); return; }
      fd.append(k, v);
    }
  }
  const fdItens = new FormData();
  fdItens.append("arquivo", arquivo);

  estado.executando = true;
  $("btn-hibrido").disabled = true;
  try {
    setStatusHibrido("⏳ Lendo catálogo…");
    const catalogo = (await carregarItens(fdItens)).map((it, i) => ({ ...it, idxCor: i }));

    setStatusHibrido("⏳ Enviando ao solver…");
    const { job_id } = await iniciarSolver(fd);
    const resultado = await aguardarResultado(job_id, (seg, fase) =>
      setStatusHibrido(`⏳ ${fase || "Executando solver…"} — ${seg}s`));

    const ed = montarEditorHibrido(resultado, catalogo);
    ed.arquivo = arquivo.name;
    if (estado.modo === "hibrido") {
      estado.catalogo = ed.catalogo;
      estado.contManual = ed.cont;
      estado.manual = ed.manual;
      estado.arquivoManual = ed.arquivo;
      reconstruirCenaManual();
    } else {
      // usuário trocou de modo durante o solve: guarda no slot do híbrido
      estado.editores.hibrido = ed;
    }
    setStatusHibrido(`✅ Solver posicionou ${resultado.itens.length} itens. Arraste/edite ou adicione as sobras.`, "ok");
  } catch (e) {
    setStatusHibrido(`❌ ${e.message}`, "erro");
  } finally {
    estado.executando = false;
    $("btn-hibrido").disabled = !$("arquivo").files[0];
  }
});

// Monta o estado do editor híbrido a partir do layout do solver (sem tocar na cena)
function montarEditorHibrido(r, catalogo) {
  const c = r.conteiner;
  const ed = novoEditor();
  ed.catalogo = catalogo;
  ed.cont = { nome: c.nome, cx: c.cx, cy: c.cy, cz: c.cz,
              peso_max_kg: c.peso_max_kg, vol_max_m3: c.vol_max_cm3 / 1_000_000 };
  for (const it of r.itens) {
    const dz = it.end_z - it.st_z;
    const cat = catalogo.find((x) => x.nome === it.nome);
    ed.manual.posicionadas.push({
      id: it.nome, item: cat || { volume_cm3: 0, peso_kg: it.peso_kg },
      stx: it.st_x, sty: it.st_y, stz: it.st_z,
      dx: it.dx, dy: it.dy, dz, girado: !!it.girado, idxCor: cat ? cat.idxCor : 0,
    });
  }
  return ed;
}

// ═══ Exportação CSV ══════════════════════════════════════════════════════════
// Uma linha por caixa posicionada: dimensões originais da planilha + posição
// final + flag de giro/rotação. Formato de dataset (vírgula, decimal com ponto,
// UTF-8) — a ideia é acumular exemplos para treinar um modelo que substitua o solver.

function csvCelula(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function linhasCsv() {
  if (estado.modo === "auto") {
    if (!estado.resultado) return [];
    // dx/dy vêm com o giro aplicado; o solver só gira no plano (X↔Y),
    // então desfazer a troca recupera comprimento/profundidade originais
    return estado.resultado.itens.map((it) => [
      it.nome, it.peso_kg,
      it.girado ? it.dy : it.dx,
      it.girado ? it.dx : it.dy,
      it.dz,
      it.st_x, it.st_y, it.st_z,
      it.girado ? "Sim" : "Não",
    ]);
  }
  if (!estado.manual) return [];
  return estado.manual.posicionadas.map((p) => {
    const o = p.item || {};
    // sem dims no catálogo (item do híbrido fora da planilha): usa as da caixa
    return [
      p.id, o.peso_kg ?? "",
      o.x ?? p.dx, o.y ?? p.dy, o.z ?? p.dz,
      p.stx, p.sty, p.stz,
      p.girado ? "Sim" : "Não",
    ];
  });
}

function exportarCsv() {
  const linhas = linhasCsv();
  if (!linhas.length) return;
  const cab = ["item", "peso_kg", "comprimento_cm", "profundidade_cm", "altura_cm",
               "pos_x_cm", "pos_y_cm", "pos_z_cm", "girado"];
  const csv = [cab, ...linhas].map((l) => l.map(csvCelula).join(",")).join("\n");
  const planilha = estado.modo === "auto" ? estado.arquivoAuto : estado.arquivoManual;
  const base = (planilha || "carregamento").replace(/\.xlsx$/i, "");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${base}_${estado.modo}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function atualizarBotaoExportar() {
  const tem = estado.modo === "auto"
    ? !!(estado.resultado && estado.resultado.itens.length)
    : !!(estado.manual && estado.manual.posicionadas.length);
  $("btn-exportar-csv").disabled = !tem;
  $("btn-exportar-pdf").disabled = !tem;
}

$("btn-exportar-csv").addEventListener("click", exportarCsv);

// ═══ Exportação PDF (documento técnico de montagem) ══════════════════════════
// Gera um PDF com a montagem do carregamento etapa por etapa: 3 caixas por
// etapa, 3 etapas por página, na sequência de montagem do chão ao topo e, em
// cada nível, do fundo à frente. Cada etapa traz uma imagem 3D (caixas da etapa
// destacadas e numeradas, anteriores esmaecidas) e a legenda com posição,
// tamanho e peso. O cabeçalho e o rodapé registram o nome da planilha enviada.

// Reúne as caixas posicionadas do modo ativo num formato único
function cargaParaPdf() {
  if (estado.modo === "auto") {
    if (!estado.resultado) return null;
    const r = estado.resultado;
    return {
      planilha: estado.arquivoAuto,
      cont: r.conteiner,
      caixas: r.itens.map((it, i) => ({
        nome: it.nome, stx: it.st_x, sty: it.st_y, stz: it.st_z,
        dx: it.dx, dy: it.dy, dz: it.end_z - it.st_z,
        peso_kg: it.peso_kg, girado: !!it.girado, idxCor: i,
        pes: it.pes ?? null, eixoPes: it.girado ? "y" : "x",
      })),
    };
  }
  if (!estado.manual || !estado.contManual) return null;
  return {
    planilha: estado.arquivoManual,
    cont: estado.contManual,
    caixas: estado.manual.posicionadas.map((p) => ({
      nome: p.id, stx: p.stx, sty: p.sty, stz: p.stz,
      dx: p.dx, dy: p.dy, dz: p.dz,
      peso_kg: p.item.peso_kg ?? 0, girado: !!p.girado, idxCor: p.idxCor,
      ...pesVisual(p),
    })),
  };
}

// Cores do GUIA DE MARCA SOHOME (RGB) — paleta principal + tons auxiliares
const MARCA = {
  ash:    [132, 134, 123],  // #84867b
  preto:  [33, 31, 30],     // #211f1e
  bege:   [197, 192, 179],  // #c5c0b3
  claro:  [220, 216, 211],  // #dcd8d3
  branco: [255, 255, 255],
};

function hexRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

// Logotipo aproximado do manual: "S O" leve + "H O M E" bold, em maiúsculas
// espaçadas (Geologica/Albert Sans não estão embutidas no jsPDF; Helvetica
// espaçada reproduz o padrão geométrico do guia). Partes: [{t, peso}].
function textoMisto(doc, x, y, partes, centroEm = null) {
  const largura = partes.reduce((s, p) => {
    doc.setFont("helvetica", p.peso);
    return s + doc.getTextWidth(p.t);
  }, 0);
  let cx = centroEm !== null ? centroEm - largura / 2 : x;
  for (const p of partes) {
    doc.setFont("helvetica", p.peso);
    doc.text(p.t, cx, y);
    cx += doc.getTextWidth(p.t);
  }
}

const LOGO_SOHOME = [{ t: "S O ", peso: "normal" }, { t: "H O M E", peso: "bold" }];

function exportarPdf() {
  const dados = cargaParaPdf();
  if (!dados || !dados.caixas.length || !window.jspdf) return;
  // Sequência de montagem por coluna: começa no fundo empilhando do chão até o
  // teto; completada a coluna, avança no X para a próxima posição e empilha de novo
  const caixas = [...dados.caixas].sort((a, b) => a.stx - b.stx || a.stz - b.stz || a.sty - b.sty);
  const c = dados.cont;
  const fotos = capturarEtapas({ cx: c.cx, cy: c.cy, cz: c.cz }, caixas, 3);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, MARG = 12;
  const IMG_W = 112, IMG_H = IMG_W * 9 / 16;  // 16:9, igual à captura
  const TX = MARG + IMG_W + 6;                // coluna da legenda

  // ── Capa (estilo do manual de marca: fundo ash, logotipo branco centrado) ──
  doc.setFillColor(...MARCA.ash);
  doc.rect(0, 0, W, H, "F");
  doc.setTextColor(...MARCA.branco);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text("G R U P O", W / 2, 112, { align: "center" });
  doc.setFontSize(28);
  textoMisto(doc, 0, 126, LOGO_SOHOME, W / 2);
  doc.setFontSize(10);
  textoMisto(doc, 0, 146, [
    { t: "D O C U M E N T O ", peso: "bold" },
    { t: "  T É C N I C O", peso: "normal" },
  ], W / 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Montagem do carregamento de contêiner", W / 2, 154, { align: "center" });

  doc.setDrawColor(...MARCA.claro);
  doc.setLineWidth(0.3);
  doc.line(70, 200, 140, 200);
  doc.setFontSize(9.5);
  [
    `Planilha enviada: ${dados.planilha || "—"}`,
    `Contêiner: ${c.nome || "—"} — ${c.cx} × ${c.cy} × ${c.cz} cm`,
    `Caixas posicionadas: ${caixas.length}  |  Etapas: ${fotos.length} (até 3 caixas por etapa)`,
    "Sequência de montagem: do fundo à frente, empilhando cada coluna do chão ao teto",
    `Gerado em ${new Date().toLocaleString("pt-BR")}`,
  ].forEach((l, i) => doc.text(l, W / 2, 210 + i * 7, { align: "center" }));

  // ── Páginas de etapas ──
  const cabecalhoPagina = () => {
    doc.addPage();
    doc.setTextColor(...MARCA.ash);
    doc.setFontSize(10);
    textoMisto(doc, MARG, 14, LOGO_SOHOME);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("Documento técnico — montagem do carregamento", W - MARG, 14, { align: "right" });
    doc.setDrawColor(...MARCA.bege);
    doc.setLineWidth(0.3);
    doc.line(MARG, 18, W - MARG, 18);
    return 28;
  };

  let y = cabecalhoPagina();
  fotos.forEach((foto, e) => {
    if (y + IMG_H + 6 > 282) y = cabecalhoPagina();  // 3 etapas por página
    const ini = e * 3;
    const grupo = caixas.slice(ini, ini + 3);

    doc.setFillColor(...MARCA.ash);
    doc.rect(MARG, y - 3.2, 2.6, 3.6, "F");  // quadrado de destaque da marca
    doc.setTextColor(...MARCA.preto);
    doc.setFontSize(10.5);
    textoMisto(doc, MARG + 5, y, [
      { t: `ETAPA ${e + 1} DE ${fotos.length}`, peso: "bold" },
      { t: `   —   CAIXAS ${ini + 1} A ${ini + grupo.length}`, peso: "normal" },
    ]);
    doc.addImage(foto, "JPEG", MARG, y + 3, IMG_W, IMG_H);
    doc.setDrawColor(...MARCA.bege);
    doc.setLineWidth(0.3);
    doc.rect(MARG, y + 3, IMG_W, IMG_H);  // moldura fina na imagem

    doc.setFontSize(8);
    let ty = y + 9;
    grupo.forEach((cx2, i) => {
      doc.setFillColor(...hexRgb(PALETA_MARCA[cx2.idxCor % PALETA_MARCA.length]));
      doc.rect(TX, ty - 2.4, 3, 3, "F");  // chip com a cor da caixa na imagem
      doc.setTextColor(...MARCA.preto);
      doc.setFont("helvetica", "bold");
      doc.text(`${ini + i + 1}. ${cx2.nome}`.slice(0, 42), TX + 5, ty);
      doc.setTextColor(...MARCA.ash);
      doc.setFont("helvetica", "normal");
      doc.text(`Posição: X ${cx2.stx} | Y ${cx2.sty} | Z ${cx2.stz} cm`, TX + 5, ty + 4);
      doc.text(`Tamanho: ${cx2.dx} × ${cx2.dy} × ${cx2.dz} cm — ${fmt(cx2.peso_kg, 1)} kg` +
               (cx2.girado ? " (rotacionada)" : ""), TX + 5, ty + 8);
      ty += 15;
    });
    y += IMG_H + 16;
  });

  // Rodapé das páginas de etapas: planilha + numeração (a capa fica limpa)
  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MARCA.ash);
    doc.text(dados.planilha || "", MARG, 291);
    doc.text(`Página ${p} de ${total}`, W - MARG, 291, { align: "right" });
  }
  doc.setProperties({ title: "Documento Técnico — Montagem do Carregamento (SOHOME)" });

  const base = (dados.planilha || "carregamento").replace(/\.xlsx$/i, "");
  doc.save(`${base}_montagem_${estado.modo}.pdf`);
}

$("btn-exportar-pdf").addEventListener("click", () => {
  try {
    exportarPdf();
  } catch (e) {
    console.error(e);
    const el = { auto: "status-solver", manual: "status-manual", hibrido: "status-hibrido" }[estado.modo];
    $(el).textContent = `❌ Falha ao gerar o PDF: ${e.message}`;
    $(el).className = "status-solver erro";
  }
});

// ═══ Utilitários ════════════════════════════════════════════════════════════

function fmt(n, casas = 0) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Rótulo amigável do tipo_caixa da planilha (null/desconhecido → null = oculta)
const TIPO_CAIXA_ROTULO = {
  malha: "🧺 Malha",
  caixa_papelao: "📦 Caixa de papelão",
  caixa_madeira: "🪵 Caixa de madeira",
};
function rotuloTipo(tipo) {
  return tipo ? TIPO_CAIXA_ROTULO[tipo] || `📦 ${tipo}` : null;
}
