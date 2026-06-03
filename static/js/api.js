// Cliente da API FastAPI (api/main.py)

export async function listarConteineres() {
  const resp = await fetch("/api/conteineres");
  if (!resp.ok) throw new Error("Falha ao buscar contêineres.");
  return (await resp.json()).conteineres;
}

export async function iniciarSolver(formData) {
  const resp = await fetch("/api/solve", { method: "POST", body: formData });
  const corpo = await resp.json();
  if (!resp.ok) throw new Error(corpo.detail || "Falha ao iniciar o solver.");
  return corpo; // { job_id, itens_total }
}

export async function consultarJob(jobId) {
  const resp = await fetch(`/api/jobs/${jobId}`);
  if (!resp.ok) throw new Error("Job não encontrado.");
  return resp.json(); // { status, resultado?, erro? }
}

// Faz polling até o job terminar; chama aoProgresso(segundosDecorridos) a cada ciclo
export async function aguardarResultado(jobId, aoProgresso, intervaloMs = 1500) {
  const inicio = performance.now();
  for (;;) {
    const job = await consultarJob(jobId);
    if (job.status === "concluido") return job.resultado;
    if (job.status === "erro") throw new Error(job.erro);
    aoProgresso(Math.round((performance.now() - inicio) / 1000));
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
}
