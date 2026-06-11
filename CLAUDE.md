# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Front-end web para o simulador de carregamento de contêiner. Página única com visualização 3D interativa (Three.js) servida por uma API FastAPI que executa o solver CP-SAT do backend **`loading-software`** — que precisa estar na pasta vizinha (mesmo diretório pai), pois `api/main.py` insere `../loading-software` no `sys.path` e importa `app.data` e `app.solver` de lá.

```
EMPACOTAMENTO/
├── loading-software/        <- backend (solver CP-SAT, venv do projeto)
└── front-loading-software/  <- este repositório
```

O app tem **3 modos de operação** (seletor no topo do painel esquerdo):
- **🤖 Automático** — roda o solver CP-SAT e mostra o resultado (fluxo original).
- **✋ Manual** — lê só o catálogo de caixas da planilha (`/api/itens`, sem solver) e o usuário posiciona cada caixa (arrasto no piso + campos X/Y/Z + rotacionar/remover). Rotação em 3 eixos: X↔Y gira no plano, X↔Z e Y↔Z tombam a caixa — só manipulação visual; o **solver não considera tombamento** (apenas o giro X↔Y dele mesmo). Regras "livres com avisos": sobrepor/sair do contêiner é permitido, mas a caixa fica vermelha e conta como problema.
- **🔀 Híbrido** — roda o solver e abre o resultado no mesmo editor manipulável do manual (itens viram caixas arrastáveis; sobras entram na paleta).

**Cada modo guarda seu próprio estado e sua própria cena 3D** — alternar entre modos não mistura nada (serve para comparar os carregamentos). Em `app.js`: o automático vive em `estado.resultado/visiveis/selecionado`; manual e híbrido têm um *editor* cada (`estado.editores.manual|hibrido`, criados por `novoEditor()`), e o editor do modo ativo é espelhado em `estado.catalogo/contManual/manual` no `setModo()`. Ao trocar de modo, `reconstruirCenaAuto()` ou `reconstruirCenaManual()` remonta a cena e os painéis a partir do estado do modo que entrou (`scene.js` exporta `limparCena()` para modos ainda vazios). Se o usuário trocar de modo enquanto um job roda, o resultado é guardado no slot do modo de origem e aparece quando ele voltar.

Não há testes ou configuração de linting no momento.

## Como rodar (gotchas importantes)

```powershell
# SEMPRE a partir DESTA pasta (front-loading-software) — rodar de outro
# diretório causa "ModuleNotFoundError: No module named 'api'"
cd front-loading-software

# SEMPRE com o python do venv do backend — o Python global da máquina
# NÃO tem fastapi/uvicorn/ortools instalados. Rodamos SEM --reload (ver gotcha).
..\loading-software\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000

# Abrir http://localhost:8000
```

As dependências de `api/requirements.txt` já estão instaladas no venv do backend (`loading-software/.venv`); não há venv próprio neste repo.

**Reload / restart (gotcha Windows):**
- **Estáticos** (`static/*.html|js|css`) são servidos do disco a cada request → mudou o front, basta **refresh no navegador** (Ctrl+Shift+R p/ furar o cache).
- **Python** (`api/` ou `loading-software/app`) → **reinicie o servidor**. NÃO usamos `--reload`: neste setup Windows o WatchFiles às vezes NÃO detecta a alteração do backend, e matar só o worker faz o reloader respawná-lo, deixando workers órfãos presos à 8000.
- Limpar a porta 8000 / matar uvicorn órfão antes de subir de novo:
```powershell
$p = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($p) { Stop-Process -Id ($p | Select-Object -Unique) -Force }
# Se persistir (workers órfãos rodam com o Python GLOBAL, não o do venv), liste e mate por PID:
# Get-CimInstance Win32_Process -Filter "name='python.exe'" | Select ProcessId, ParentProcessId, CommandLine
```

## Architecture

```
api/
└── main.py          # FastAPI: /api/conteineres, /api/itens (catálogo), /api/solve (assíncrono), serve static/
static/
├── index.html       # página única; seletor de modo + 3 painéis (input | viewport 3D | itens/paleta)
├── style.css
└── js/
    ├── app.js       # estado + modos (auto/manual/hibrido); controles do auto e toda a lógica do manual
    ├── scene.js     # cena Three.js: contêiner, caixas (auto read-only e manual arrastáveis), labels, picking, drag no piso
    └── api.js       # cliente fetch (conteineres, itens, solve + polling do job)
```

### API (`api/main.py`)

- `GET /api/conteineres` — catálogo vindo de `CONTEINERES` do backend (id, nome, dimensões cm, peso_max_kg, vol_max_m3).
- `POST /api/itens` — multipart: `arquivo` (.xlsx). Lê o **catálogo** de itens via `carregar_itens` **sem rodar o solver** e retorna `{itens: [{nome, x, y, z (cm), peso_kg, volume_cm3}]}`. Usado pelo **modo manual** para montar a paleta de caixas.
- `POST /api/solve` — multipart: `arquivo` (.xlsx) + `conteiner` (id ou `"personalizado"` com `cx/cy/cz/peso_max_kg/vol_max_m3`). Lê a planilha, dispara o solver numa **thread daemon** e retorna `{job_id, itens_total, tempo_solver}` imediatamente (o solver pode levar minutos). O campo `tempo` do form é ignorado: tempo da fase 2 travado em 180 s.
- A leitura/validação do `.xlsx` é centralizada no helper `_ler_planilha(arquivo)` (usado por `/api/itens` e `/api/solve`).
- `GET /api/jobs/{job_id}` — polling: `{status: "executando"|"concluido"|"erro", fase?, resultado?, erro?}`. `fase` é a fase em andamento do solver ("Fase N de 3 — …"), alimentada pelo callback `progresso` de `resolver_carregamento`; o front exibe no status junto ao contador de segundos. Jobs ficam em memória no dict `JOBS` (perdidos a cada restart).
- `app.mount("/")` com `StaticFiles` serve `static/` — montado **por último** para não capturar `/api/*`.
- No topo do módulo, `sys.stdout/stderr` são reconfigurados para UTF-8: os `print()` do backend usam emojis que quebram no console charmap do Windows.
- O resultado do solver é remontado em `_montar_resultado()`: estatísticas (peso/volume/avanço/pesados no chão via `LIMITE_PESADO_G`), itens posicionados em ordem de entrada e itens não carregados.

### Front (`static/`)

- `app.js` mantém `estado` (incl. `estado.modo`). `setModo()` alterna a UI por modo: cards de ação (esquerda), barra de controles (centro) e painel direito (`#painel-auto` vs `#painel-manual`).
- **Modo automático:** controle interativo `←`/`→` (retrocede/avança 1 item na ordem de entrada, fundo → frente), `Todos`, `Limpar`; setas do teclado também (só no modo auto). `api.js → aguardarResultado()` faz polling de 1,5s até o job concluir. Painel direito: detalhes por item.
- **Modo manual** (todo em `app.js`, seção "Modo manual"): `Carregar caixas` → `/api/itens` → paleta (`#manual-palette`). Clicar numa caixa a posiciona (nasce enfileirada no eixo X p/ não sobrepor) e a seleciona; arraste no piso (mouse) ou edite X/Y/Z + rotações `X↔Y`/`X↔Z`/`Y↔Z` (via `rotacionarSel`) + `Remover`. Selecionar uma caixa (cena 3D ou lista) rola a lista "Posicionadas" até ela e expande o card com nome, posição, tamanho e peso; durante arrasto/edição de coordenadas só o texto da posição é atualizado (`atualizarCardSel`), sem re-render da lista. A caixa selecionada exibe **6 setas de deslizamento** (cones amarelos nas faces, em `scene.js`); clicar numa seta desliza a caixa naquele sentido até encostar no primeiro obstáculo cuja projeção cruza a dela nos outros dois eixos, ou até o limite do contêiner (`deslizarSel` em `app.js`); caixas já sobrepostas não bloqueiam o deslize. As setas são filhas do mesh (acompanham movimento sozinhas; reposicionam no resize via `posicionarSetas`); o clique nelas tem prioridade sobre pegar a caixa quando for o alvo mais próximo (`cliqueConsumido` evita que o pointerup desselecione). `recalcManual()` recomputa sobreposição e fora-dos-limites (O(n²), simples) e pinta os inválidos de vermelho via `marcarInvalidos`. Stats ao vivo no mesmo `#stats`. **Ctrl+Z desfaz, Ctrl+Shift+Z (ou Ctrl+Y) refaz** (manual e híbrido, cada editor com suas pilhas em `estado.manual.undo/redo`, máx. 50): `pushUndo(grupo?)` guarda um snapshot de `posicionadas`+`selId` ANTES de cada mutação (posicionar, arrastar, campos X/Y/Z, deslizar, girar, remover) e zera o redo; gestos contínuos (arrasto `mover:{id}`, digitação `campos:{id}`) são agrupados por grupo+janela de 1,5 s, então um Ctrl+Z desfaz o gesto inteiro. `desfazer()`/`refazer()` empilham o estado atual na pilha oposta e restauram via `reconstruirCenaManual()`. Os atalhos funcionam mesmo com foco nos inputs X/Y/Z (preventDefault no keydown global).
- **Exportar PDF (montagem)** (botão no card de estatísticas, ao lado do CSV, mesma condição de habilitação): seção "Exportação PDF" em `app.js` gera, todo no front (jsPDF UMD via CDN, `window.jspdf`), um documento técnico A4 com a montagem etapa por etapa — caixas ordenadas por `(stx, stz, sty)` (fundo→frente, coluna a coluna; em cada posição empilha chão→teto antes de avançar no X), 3 caixas por etapa, 3 etapas por página. Cada etapa traz uma imagem 3D renderizada por `capturarEtapas()` (`scene.js`): cena temporária offscreen (fundo branco p/ impressão, WebGLRenderer próprio descartado com `forceContextLoss()`), caixas da etapa destacadas com marcador numerado (sprite de canvas), anteriores esmaecidas (opacity 0.3) — não toca na cena principal. **Visual segue o "GUIA DE MARCA SOHOME.pdf"** (raiz de EMPACOTAMENTO): capa ash `#84867b` com logotipo "S O **H O M E**" branco, cabeçalho/rodapé e detalhes nas cores da marca (consts `MARCA` em `app.js`), e as caixas das imagens usam `PALETA_MARCA` (exportada por `scene.js`; a cena na tela continua com `PALETA`) com chip de cor correspondente na legenda. Tipografia da marca (Geologica/Albert Sans) não é embutida — aproximada com Helvetica em maiúsculas espaçadas (`textoMisto()`). Cabeçalho da capa e rodapé registram o nome da planilha enviada; nome do arquivo: `{planilha}_montagem_{modo}.pdf`. Sem emojis no texto do PDF (helvetica/WinAnsi do jsPDF não os renderiza).
- **Exportar CSV** (botão no card de estatísticas, ativo nos 3 modos quando há caixas posicionadas): seção "Exportação CSV" em `app.js` gera, todo no front (Blob), uma linha por caixa com `item, peso_kg, comprimento_cm, profundidade_cm, altura_cm (dimensões ORIGINAIS da planilha), pos_x_cm, pos_y_cm, pos_z_cm, girado` — formato de dataset (vírgula, decimal ponto, UTF-8) para futuramente treinar um modelo neural que substitua o solver. No auto, as dims originais são recuperadas desfazendo o giro X↔Y (`girado ? dy : dx`); no manual/híbrido vêm de `p.item` (catálogo) com fallback nas dims da caixa, e `girado` cobre qualquer rotação (dims ≠ originais). O nome do arquivo carregado é rastreado por modo (`estado.arquivoAuto` e `arquivo` em cada editor, espelhado em `estado.arquivoManual`) e vira `{planilha}_{modo}.csv`.
- `scene.js` desenha em **centímetros** nas mesmas coordenadas do solver (X = comprimento, fundo em X=0). `desenharConteiner()` (limpa + wireframe + piso + eixos + câmera) é compartilhado por `setCarga` (auto, read-only) e `initManual` (manual). Manual: `adicionar/mover/redimensionar/remover/selecionarCaixaManual` (`redimensionarCaixaManual` recria a geometria após qualquer rotação dx/dy/dz), `marcarInvalidos`, e arrasto via raycast num plano horizontal na altura da caixa (trava o OrbitControls ao pegar a caixa). Eixos: backend X→three X, backend Y→three Z, backend Z→three Y.
  - **Gotcha de label:** os labels são `CSS2DObject`; o `CSS2DRenderer` NÃO remove o `<div>` do DOM ao tirar o objeto da cena. `descartar()` remove geometria+material **e** o nó DOM do label (`o.element.parentNode.removeChild`), senão sobra label órfão ao remover caixa/recarregar.

### Contrato com o backend

Vem de `loading-software` (ver CLAUDE.md de lá): `resolver_carregamento(cont, itens_dados) -> (lista, dados)` com posições em cm, pesos em gramas, volumes em cm³ — a API converte para kg/m³ nas respostas. Planilha de entrada: colunas `ITEM`, `qtd` (opcional), `peso` (kg), `comprimento`, `profundidade`, `altura` (m), `volume` (m³).

## Requisitos originais do front (referência)

- Visualização 3D manipulável (rotação/zoom/pan), caixas em cores distintas com label.
- Lista suspensa de contêineres do backend + opção personalizada (dimensões, peso_max, vol_max).
- Controle interativo: avançar/retroceder item a item, `Todos`, `Limpar`.
- Painel esquerdo: input (arquivo, contêiner), botão executar, estatísticas gerais (itens carregados, peso, volume, avanço, itens >80 kg no chão).
- Painel direito: por item — nome, dimensões, peso, coordenadas, girado Sim/Não.
- Tudo numa página só.
