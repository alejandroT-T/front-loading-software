# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Front-end web para o simulador de carregamento de contêiner. Página única com visualização 3D interativa (Three.js) servida por uma API FastAPI que executa o solver CP-SAT do backend **`loading-software`** — que precisa estar na pasta vizinha (mesmo diretório pai), pois `api/main.py` insere `../loading-software` no `sys.path` e importa `app.data` e `app.solver` de lá.

```
EMPACOTAMENTO/
├── loading-software/        <- backend (solver CP-SAT, venv do projeto)
└── front-loading-software/  <- este repositório
```

Não há testes ou configuração de linting no momento.

## Como rodar (gotchas importantes)

```powershell
# SEMPRE a partir DESTA pasta (front-loading-software) — rodar de outro
# diretório causa "ModuleNotFoundError: No module named 'api'"
cd front-loading-software

# SEMPRE com o python do venv do backend — o Python global da máquina
# NÃO tem fastapi/uvicorn/ortools instalados
..\loading-software\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --reload-dir api --reload-dir ..\loading-software\app

# Abrir http://localhost:8000
```

As dependências de `api/requirements.txt` já estão instaladas no venv do backend (`loading-software/.venv`); não há venv próprio neste repo.

## Architecture

```
api/
└── main.py          # FastAPI: catálogo de contêineres, upload xlsx, solver assíncrono, serve static/
static/
├── index.html       # página única (3 painéis: input | viewport 3D | detalhes dos itens)
├── style.css
└── js/
    ├── app.js       # estado da aplicação + controles (avançar/retroceder/todos/limpar, seleção)
    ├── scene.js     # cena Three.js: contêiner wireframe, caixas coloridas, labels, picking
    └── api.js       # cliente fetch da API + polling do job
```

### API (`api/main.py`)

- `GET /api/conteineres` — catálogo vindo de `CONTEINERES` do backend (id, nome, dimensões cm, peso_max_kg, vol_max_m3).
- `POST /api/solve` — multipart: `arquivo` (.xlsx) + `conteiner` (id ou `"personalizado"` com `cx/cy/cz/peso_max_kg/vol_max_m3`). Valida e lê a planilha via `carregar_itens` do backend, então dispara o solver numa **thread daemon** e retorna `{job_id, itens_total}` imediatamente (o solver pode levar minutos).
- `GET /api/jobs/{job_id}` — polling: `{status: "executando"|"concluido"|"erro", resultado?, erro?}`. Jobs ficam em memória no dict `JOBS` (perdidos a cada restart).
- `app.mount("/")` com `StaticFiles` serve `static/` — montado **por último** para não capturar `/api/*`.
- No topo do módulo, `sys.stdout/stderr` são reconfigurados para UTF-8: os `print()` do backend usam emojis que quebram no console charmap do Windows.
- O resultado do solver é remontado em `_montar_resultado()`: estatísticas (peso/volume/avanço/pesados no chão via `LIMITE_PESADO_G`), itens posicionados em ordem de entrada e itens não carregados.

### Front (`static/`)

- `app.js` mantém o `estado` (resultado, nº de itens visíveis, item selecionado) e implementa o controle interativo: `←`/`→` retrocede/avança um item na ordem de entrada (fundo → frente), `Todos`, `Limpar`; setas do teclado também funcionam. Painel esquerdo: upload + contêiner + estatísticas; painel direito: detalhes por item (coordenadas, encaixe, girado).
- `api.js` → `aguardarResultado()` faz polling de 1,5s até o job concluir.
- `scene.js` desenha em **centímetros** nas mesmas coordenadas do solver (X = comprimento, fundo em X=0) e suporta clique para selecionar/destacar item.

### Contrato com o backend

Vem de `loading-software` (ver CLAUDE.md de lá): `resolver_carregamento(cont, itens_dados) -> (lista, dados)` com posições em cm, pesos em gramas, volumes em cm³ — a API converte para kg/m³ nas respostas. Planilha de entrada: colunas `ITEM`, `qtd` (opcional), `peso` (kg), `comprimento`, `profundidade`, `altura` (m), `volume` (m³).

## Requisitos originais do front (referência)

- Visualização 3D manipulável (rotação/zoom/pan), caixas em cores distintas com label.
- Lista suspensa de contêineres do backend + opção personalizada (dimensões, peso_max, vol_max).
- Controle interativo: avançar/retroceder item a item, `Todos`, `Limpar`.
- Painel esquerdo: input (arquivo, contêiner), botão executar, estatísticas gerais (itens carregados, peso, volume, avanço, itens >80 kg no chão).
- Painel direito: por item — nome, dimensões, peso, coordenadas, girado Sim/Não.
- Tudo numa página só.
