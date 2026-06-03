# front-loading-software

Front-end web para o simulador de carregamento de contêiner ([loading-software](../loading-software)).

Página única com visualização 3D interativa (Three.js) servida por uma API FastAPI que executa o solver CP-SAT do backend.

## Estrutura

```
front-loading-software/
├── api/
│   ├── main.py          # FastAPI: contêineres, upload xlsx, solver assíncrono
│   └── requirements.txt
└── static/
    ├── index.html       # página única (3 painéis)
    ├── style.css
    └── js/
        ├── app.js       # estado da aplicação + controles
        ├── scene.js     # cena Three.js (3D)
        └── api.js       # cliente da API
```

> O backend `loading-software` precisa estar na pasta vizinha (mesmo diretório pai),
> pois a API importa `app.data`, `app.solver` diretamente de lá.

## Como rodar

```powershell
# 1. Instalar dependências (uma vez)
pip install -r api/requirements.txt

# 2. Subir o servidor (na pasta front-loading-software)
#    --reload-dir faz o servidor reiniciar sozinho quando o código Python
#    mudar — tanto da API quanto do backend (loading-software)
uvicorn api.main:app --reload --reload-dir api --reload-dir ..\loading-software\app

# 3. Abrir no navegador
# http://localhost:8000
```

## Uso

1. **Painel esquerdo**: escolha a planilha `.xlsx` (colunas: ITEM, qtd, peso, comprimento, profundidade, altura, volume) e o contêiner (ou "Personalizado" com dimensões próprias).
2. Clique em **▶ Executar solver** — o solver pode levar de segundos a alguns minutos.
3. **Centro**: visualização 3D com rotação (arrastar), zoom (scroll) e pan (botão direito).
4. **Controle interativo**: `←`/`→` retrocede/avança um item na ordem de entrada (do fundo para frente), `Todos` posiciona tudo, `Limpar` esvazia. As setas do teclado também funcionam.
5. **Painel direito**: detalhes de cada item posicionado (coordenadas, encaixe, giro, peso).
6. **Painel esquerdo-inferior**: estatísticas gerais (itens, peso, volume, avanço, pesados no chão) e itens que ficaram fora.
