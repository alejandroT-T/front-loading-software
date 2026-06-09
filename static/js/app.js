// Estado da aplicação + ligação entre UI, API e cena 3D

import { listarConteineres, iniciarSolver, aguardarResultado } from "./api.js";
import { initScene, setCarga, mostrarAte, PALETA, onSelecionar, selecionarItem } from "./scene.js";

const $ = (id) => document.getElementById(id);

const estado = {
  conteineres: [],   // catálogo vindo da API
  resultado: null,   // resposta do solver
  visiveis: 0,       // quantos itens estão posicionados na cena
  selecionado: null, // índice do item destacado (null = nenhum)
  executando: false,
};

// ═══ Inicialização ══════════════════════════════════════════════════════════

initScene($("viewport"));
carregarConteineres();

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
    const resultado = await aguardarResultado(job_id, (seg) => {
      setStatus(`⏳ Executando solver… ${seg}s`);
    });
    estado.resultado = resultado;
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
  $("viewport-vazio").style.display = "none";

  // Estatísticas gerais (painel esquerdo-inferior)
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

  // Cena 3D — começa com todos os itens posicionados, sem seleção
  estado.selecionado = null;
  setCarga(r.itens, r.conteiner);
  setVisiveis(r.itens.length);
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
    return `
      <div class="item-card${atual}${sel}" data-indice="${i}" style="--cor-item:${cor}">
        <div class="item-titulo">${it.sequencia}º ITEM A ENTRAR: 📦 ${it.nome}</div>
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

// ═══ Utilitários ════════════════════════════════════════════════════════════

function fmt(n, casas = 0) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
