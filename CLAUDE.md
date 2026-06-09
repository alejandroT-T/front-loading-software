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
- **✋ Manual** — lê só o catálogo de caixas da planilha (`/api/itens`, sem solver) e o usuário posiciona cada caixa (arrasto no piso + campos X/Y/Z + girar/remover). Regras "livres com avisos": sobrepor/sair do contêiner é permitido, mas a caixa fica vermelha e conta como problema.
- **🔀 Híbrido** — rodar o solver e depois manipular as cargas. **Ainda placeholder (etapa 3, não implementado).**

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
- `GET /api/jobs/{job_id}` — polling: `{status: "executando"|"concluido"|"erro", resultado?, erro?}`. Jobs ficam em memória no dict `JOBS` (perdidos a cada restart).
- `app.mount("/")` com `StaticFiles` serve `static/` — montado **por último** para não capturar `/api/*`.
- No topo do módulo, `sys.stdout/stderr` são reconfigurados para UTF-8: os `print()` do backend usam emojis que quebram no console charmap do Windows.
- O resultado do solver é remontado em `_montar_resultado()`: estatísticas (peso/volume/avanço/pesados no chão via `LIMITE_PESADO_G`), itens posicionados em ordem de entrada e itens não carregados.

### Front (`static/`)

- `app.js` mantém `estado` (incl. `estado.modo`). `setModo()` alterna a UI por modo: cards de ação (esquerda), barra de controles (centro) e painel direito (`#painel-auto` vs `#painel-manual`).
- **Modo automático:** controle interativo `←`/`→` (retrocede/avança 1 item na ordem de entrada, fundo → frente), `Todos`, `Limpar`; setas do teclado também (só no modo auto). `api.js → aguardarResultado()` faz polling de 1,5s até o job concluir. Painel direito: detalhes por item.
- **Modo manual** (todo em `app.js`, seção "Modo manual"): `Carregar caixas` → `/api/itens` → paleta (`#manual-palette`). Clicar numa caixa a posiciona (nasce enfileirada no eixo X p/ não sobrepor) e a seleciona; arraste no piso (mouse) ou edite X/Y/Z + `Girar`/`Remover`. `recalcManual()` recomputa sobreposição e fora-dos-limites (O(n²), simples) e pinta os inválidos de vermelho via `marcarInvalidos`. Stats ao vivo no mesmo `#stats`.
- `scene.js` desenha em **centímetros** nas mesmas coordenadas do solver (X = comprimento, fundo em X=0). `desenharConteiner()` (limpa + wireframe + piso + eixos + câmera) é compartilhado por `setCarga` (auto, read-only) e `initManual` (manual). Manual: `adicionar/mover/girar/remover/selecionarCaixaManual`, `marcarInvalidos`, e arrasto via raycast num plano horizontal na altura da caixa (trava o OrbitControls ao pegar a caixa). Eixos: backend X→three X, backend Y→three Z, backend Z→three Y.
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
