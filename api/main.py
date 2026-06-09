"""API FastAPI que integra o front com o backend loading-software.

O backend (loading-software) fica na pasta vizinha a este repositório:
    EMPACOTAMENTO/
    ├── loading-software/        <- backend (solver CP-SAT)
    └── front-loading-software/  <- este repositório
"""
import sys
import tempfile
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

# O backend usa print() com emojis; no Windows o console padrão (charmap)
# não os suporta — força UTF-8 para o solver não quebrar
for _stream in (sys.stdout, sys.stderr):
    if _stream and hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# Torna o backend importável (pacote `app` de loading-software)
RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "loading-software"))

from app.data.conteiners import CONTEINERES, conteiner_personalizado, Conteiner  # noqa: E402
from app.data.modelos import carregar_itens  # noqa: E402
from app.solver.solver import resolver_carregamento  # noqa: E402
from app.solver.restricoes import LIMITE_PESADO_G  # noqa: E402

api = FastAPI(title="Loading Software API")

# Jobs do solver em memória: {job_id: {"status": "executando"|"concluido"|"erro", ...}}
JOBS: dict = {}


# ═══ Contêineres ═══════════════════════════════════════════════════════════

@api.get("/api/conteineres")
def listar_conteineres():
    return {
        "conteineres": [
            {
                "id": chave,
                "nome": c.nome,
                "cx": c.cx,
                "cy": c.cy,
                "cz": c.cz,
                "peso_max_kg": c.peso_max / 1000,
                "vol_max_m3": c.vol_max / 1_000_000,
            }
            for chave, c in CONTEINERES.items()
        ]
    }


# ═══ Solver (assíncrono com polling) ═══════════════════════════════════════

def _montar_resultado(lista: list, itens_dados: dict, cont: Conteiner) -> dict:
    nomes_carregados = {e["nome"] for e in lista}

    itens = []
    for seq, e in enumerate(lista, 1):
        d = itens_dados[e["nome"]]
        itens.append({
            "sequencia": seq,
            "nome": e["nome"],
            "st_x": e["st_x"], "end_x": e["end_x"],
            "st_y": e["st_y"], "end_y": e["end_y"],
            "st_z": e["st_z"], "end_z": e["end_z"],
            "dx": e["dx"], "dy": e["dy"], "dz": d["z"],
            "peso_kg": d["peso"] / 1000,
            "girado": e["girado"].startswith("Sim"),
        })

    peso_total = sum(itens_dados[n]["peso"] for n in nomes_carregados)
    vol_total = sum(itens_dados[n]["volume"] for n in nomes_carregados)
    avanco = max((e["end_x"] for e in lista), default=0)

    pesados = [n for n in nomes_carregados if itens_dados[n]["peso"] > LIMITE_PESADO_G]
    pesados_no_chao = [
        e["nome"] for e in lista
        if itens_dados[e["nome"]]["peso"] > LIMITE_PESADO_G and e["st_z"] == 0
    ]

    nao_carregados = [
        {
            "nome": n,
            "peso_kg": d["peso"] / 1000,
            "volume_cm3": d["volume"],
        }
        for n, d in itens_dados.items()
        if n not in nomes_carregados
    ]

    return {
        "conteiner": {
            "nome": cont.nome,
            "cx": cont.cx, "cy": cont.cy, "cz": cont.cz,
            "peso_max_kg": cont.peso_max / 1000,
            "vol_max_cm3": cont.vol_max,
        },
        "estatisticas": {
            "itens_carregados": len(lista),
            "itens_total": len(itens_dados),
            "peso_total_kg": peso_total / 1000,
            "peso_max_kg": cont.peso_max / 1000,
            "volume_total_cm3": vol_total,
            "volume_max_cm3": cont.vol_max,
            "avanco_cm": avanco,
            "comprimento_cm": cont.cx,
            "pesados_no_chao": len(pesados_no_chao),
            "pesados_total": len(pesados),
        },
        "itens": itens,
        "nao_carregados": nao_carregados,
    }


def _executar_solver(job_id: str, cont: Conteiner, itens_dados: dict, tempo_fase2: float) -> None:
    try:
        lista, dados = resolver_carregamento(cont, itens_dados, tempo_fase2=tempo_fase2)
        if not lista:
            JOBS[job_id] = {"status": "erro", "erro": "O solver não encontrou solução viável."}
            return
        JOBS[job_id] = {"status": "concluido", "resultado": _montar_resultado(lista, dados, cont)}
    except Exception as exc:  # noqa: BLE001 — repassa qualquer falha ao front
        JOBS[job_id] = {"status": "erro", "erro": str(exc)}


@api.post("/api/solve")
async def iniciar_solver(
    arquivo: UploadFile = File(...),
    conteiner: str = Form(...),
    cx: int | None = Form(None),
    cy: int | None = Form(None),
    cz: int | None = Form(None),
    peso_max_kg: float | None = Form(None),
    vol_max_m3: float | None = Form(None),
    tempo: float | None = Form(None),
):
    # Tempo do solver (fase 2) TRAVADO em 180 s (o campo `tempo` é ignorado de propósito)
    tempo_fase2 = 180.0

    # Resolve o contêiner escolhido
    if conteiner == "personalizado":
        if None in (cx, cy, cz, peso_max_kg, vol_max_m3):
            raise HTTPException(400, "Contêiner personalizado exige cx, cy, cz, peso_max_kg e vol_max_m3.")
        cont = conteiner_personalizado(cx, cy, cz, peso_max_kg, vol_max_m3)
    elif conteiner in CONTEINERES:
        cont = CONTEINERES[conteiner]
    else:
        raise HTTPException(400, f"Contêiner desconhecido: {conteiner}")

    # Salva o upload num temporário e carrega os itens via modelos.py
    if not arquivo.filename or not arquivo.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Envie um arquivo .xlsx.")

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(await arquivo.read())
        caminho = Path(tmp.name)

    try:
        itens_dados = carregar_itens(caminho)
    except KeyError as exc:
        raise HTTPException(400, f"Coluna ausente na planilha: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Falha ao ler a planilha: {exc}") from exc
    finally:
        caminho.unlink(missing_ok=True)

    if not itens_dados:
        raise HTTPException(400, "A planilha não contém itens.")

    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"status": "executando"}
    threading.Thread(
        target=_executar_solver, args=(job_id, cont, itens_dados, tempo_fase2), daemon=True
    ).start()

    return {"job_id": job_id, "itens_total": len(itens_dados), "tempo_solver": tempo_fase2}


@api.get("/api/jobs/{job_id}")
def consultar_job(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "Job não encontrado.")
    return job


# ═══ Front estático (montado por último para não capturar /api/*) ══════════

api.mount("/", StaticFiles(directory=Path(__file__).resolve().parents[1] / "static", html=True), name="static")

# Alias esperado pelo uvicorn: `uvicorn api.main:app`
app = api
