Desenvolvimento do front-end para visualizar a simulação da carga no conteiner

# FUNCIONALIDEDES
1. Aceitar arquivo .xlsx que contem as informações do projeto (ITEM, qtd, peso, comprimento, profundidade, altura, volume)
2. Enviar esses dados para o arquivo modelos.py do backend
3. Poder de escolha do conteiner, como utilizado em conteiners.py
4. Os arquivos da pasta solver irão ler o arquivo modelos.py e conteiners.py e executar o solver com as restrições
5. A pasta interface contém o código em pyvista para visualizar pelo vscode (mantém, porém nao é util para o front)
6. com o resultado do solver apresentar no front

# REQUISITOS PARA O FRONT

## VISUALIZAÇÃO 3D INTERATIVA
- Visualização 3D manipulavel com rotação e zoom
- Lista suspena para escolher os conteiners do back end. Para a opção personalizada, informar as dimensões do conteiner, peso_max, volume_max e enviar para o conteiners.py as informações
- renderização em tempo real das caixas em cores disitintas e label
- controle interativo para visualizar desde um item no conteiner até todos
    - --> avança 1 item
    - <-- retrocede 1 item
    - [button:Todos] --> posiciona todos os produtos de uma vez
    - [button:Limpar] --> Limpa todos os itens do conteiner, deixando vazio

## LAYOUT DA INTERFACE
- Painel esquerdo-superior para input dos dados
    - Arquivo
    - Conteiner
- Centro do Painel esquerdo
    - Botão para executar solver
- Painel esquerdo-inferior para Informações gerais
    - Itens carregados: n/n_total_itens
    - Peso: p/p_max_conteiner
    - Volume: v/v_max_conteiner
    - Itens > 80Kg no chão: n_pesados/n_total_itens_pesados
    - Exemplo:
        📊 Itens carregados : 64/64
        ⚖️  Peso total       : 3422.2 kg / 28600 kg (12.0%)
        📦 Volume total     : 59,724,108 cm³ / 76,000,000 cm³ (78.6%)
        📏 Avanço no contêiner: 1166 cm de 1203 cm (96.9% do comprimento)
        ⚠️  Itens >80 kg no chão: 10/17
- Centro da tela o visualizado interativo
- No inferior do centro da tela o controle interativo
- Painel direito: mostra cada item que foi carregado, seguindo a regra da tela do controle interativo
    - informações individuais do item
        - nome do item (Coluna ITEM do .xlsx)
        - Comprimento
        - Profundidade
        - Altura
        - Peso
        - Coordenadas da posição
        - Girado: Sim/Não
        - Exemplo:
            1º ITEM A ENTRAR: 📦 78058 - ALCALA (5165281)_1
            📍 Comprimento (X): 0 cm ➡️  62 cm
            ↔️  Lateral    (Y): 12 cm — 150 cm
            ↕️  Altura     (Z): 104 cm — 170 cm
            📐 Encaixe: 62×138×66 cm | Girado: Sim (90°)
- Faça tudo numa página só

# INTEGRAÇÃO
- Integre o front com back: front-loading-software e back: loading-software
