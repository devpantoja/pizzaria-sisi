// Popula o banco com dados demo consistentes pros prints do manual.
// Uso: node manual/seed-demo.js
// ATENÇÃO: apaga tudo do banco antes.

import { unlinkSync, existsSync } from 'node:fs';

const DB_PATH = './data/pizzaria.db';
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
if (existsSync(DB_PATH + '-wal')) unlinkSync(DB_PATH + '-wal');
if (existsSync(DB_PATH + '-shm')) unlinkSync(DB_PATH + '-shm');

// Carrega módulos DEPOIS de apagar o arquivo — assim recriam schema do zero
const { criarSenha, marcarPronta } = await import('../db.js');
const { criarCategoria, criarItem } = await import('../cardapio.js');
const { criarPedido } = await import('../pedidos.js');
const { criarPropaganda, listarPropagandas } = await import('../propagandas.js');

// ============= CATEGORIAS =============
const catSalgadas = criarCategoria({ nome: 'Pizzas Salgadas', ordem: 1 });
const catDoces = criarCategoria({ nome: 'Pizzas Doces', ordem: 2 });
const catBebidas = criarCategoria({ nome: 'Bebidas', ordem: 3 });

console.log('✓ 3 categorias criadas');

// ============= ITENS =============
const tamPizza = (bt, md, gd) => [
  { nome: 'Broto', preco_centavos: bt, ordem: 0 },
  { nome: 'Média', preco_centavos: md, ordem: 1 },
  { nome: 'Grande', preco_centavos: gd, ordem: 2 },
];

const adicionaisPizza = [
  { nome: 'Borda Catupiry', preco_centavos: 800, ordem: 0 },
  { nome: 'Borda Cheddar', preco_centavos: 800, ordem: 1 },
  { nome: 'Extra Queijo', preco_centavos: 500, ordem: 2 },
];

// Pizzas salgadas
const margherita = criarItem({
  categoria_id: catSalgadas.id,
  nome: 'Margherita',
  descricao: 'Molho de tomate, mussarela, tomate fresco, manjericão e azeite',
  tamanhos: tamPizza(2900, 4500, 5900),
  adicionais: adicionaisPizza,
});

const calabresa = criarItem({
  categoria_id: catSalgadas.id,
  nome: 'Calabresa',
  descricao: 'Molho, mussarela, calabresa fatiada, cebola e orégano',
  tamanhos: tamPizza(3200, 4800, 6200),
  adicionais: adicionaisPizza,
});

const portuguesa = criarItem({
  categoria_id: catSalgadas.id,
  nome: 'Portuguesa',
  descricao: 'Presunto, ovo, cebola, azeitona, mussarela e ervilha',
  tamanhos: tamPizza(3500, 5200, 6500),
  adicionais: adicionaisPizza,
});

const quatroQueijos = criarItem({
  categoria_id: catSalgadas.id,
  nome: 'Quatro Queijos',
  descricao: 'Mussarela, provolone, parmesão e gorgonzola',
  tamanhos: tamPizza(3800, 5500, 6900),
  adicionais: adicionaisPizza,
});

const frangoCatupiry = criarItem({
  categoria_id: catSalgadas.id,
  nome: 'Frango c/ Catupiry',
  descricao: 'Frango desfiado, catupiry, milho e orégano',
  tamanhos: tamPizza(3500, 5200, 6500),
  adicionais: adicionaisPizza,
  disponivel: false,   // exemplo de esgotado
});

// Pizzas doces
const chocolate = criarItem({
  categoria_id: catDoces.id,
  nome: 'Chocolate c/ Morango',
  descricao: 'Chocolate ao leite derretido e morangos frescos',
  tamanhos: tamPizza(3500, 4900, 6200),
  adicionais: [
    { nome: 'Chocolate Branco', preco_centavos: 700, ordem: 0 },
    { nome: 'Extra Morango', preco_centavos: 500, ordem: 1 },
  ],
});

const romeuJulieta = criarItem({
  categoria_id: catDoces.id,
  nome: 'Romeu e Julieta',
  descricao: 'Mussarela e goiabada cremosa',
  tamanhos: tamPizza(3200, 4700, 6000),
  adicionais: [],
});

// Bebidas
const cocaCola = criarItem({
  categoria_id: catBebidas.id,
  nome: 'Coca-Cola',
  tamanhos: [
    { nome: '350ml', preco_centavos: 700, ordem: 0 },
    { nome: '600ml', preco_centavos: 1200, ordem: 1 },
    { nome: '2L', preco_centavos: 1600, ordem: 2 },
  ],
  adicionais: [],
});

const guarana = criarItem({
  categoria_id: catBebidas.id,
  nome: 'Guaraná Antarctica',
  tamanhos: [
    { nome: '350ml', preco_centavos: 700, ordem: 0 },
    { nome: '2L', preco_centavos: 1500, ordem: 1 },
  ],
  adicionais: [],
});

const sucoLaranja = criarItem({
  categoria_id: catBebidas.id,
  nome: 'Suco de Laranja Natural',
  descricao: 'Feito na hora, 500ml',
  tamanhos: [
    { nome: 'Copo 500ml', preco_centavos: 1200, ordem: 0 },
  ],
  adicionais: [],
});

console.log('✓ 10 itens criados (1 esgotado como exemplo)');

// ============= PEDIDOS/SENHAS =============
// Cria uma sequência de senhas em vários estados pra demonstrar o painel

// Senha 1 — entregue (não aparece no painel, mas conta no relatório)
const p1 = criarPedido({
  senhaId: criarSenha().id,
  linhas: [
    { item_id: margherita.id, tamanho_id: margherita.tamanhos[2].id, quantidade: 1, adicionais_ids: [] },
    { item_id: cocaCola.id, tamanho_id: cocaCola.tamanhos[0].id, quantidade: 2, adicionais_ids: [] },
  ],
  observacao: '',
});
// Simula que já foi entregue: precisamos avançar status manualmente
const dbModule = await import('../db.js');
const senha1Id = p1.senha_id;
dbModule.marcarPronta(senha1Id);
dbModule.marcarEntregue(senha1Id);

// Senha 2 — pronta (aparece em DESTAQUE no painel)
const p2 = criarPedido({
  senhaId: criarSenha().id,
  linhas: [
    {
      item_id: calabresa.id,
      item2_id: quatroQueijos.id,
      tamanho_id: calabresa.tamanhos[2].id,
      tamanho2_id: quatroQueijos.tamanhos[2].id,
      quantidade: 1,
      adicionais_ids: [calabresa.adicionais[0].id],
    },
    { item_id: guarana.id, tamanho_id: guarana.tamanhos[1].id, quantidade: 1, adicionais_ids: [] },
  ],
  observacao: 'Sem cebola',
});
dbModule.marcarPronta(p2.senha_id);

// Senhas 3-6 — em preparação (aparecem na coluna esquerda)
const senhaIds = [];
senhaIds.push(criarPedido({
  senhaId: criarSenha().id,
  linhas: [{ item_id: portuguesa.id, tamanho_id: portuguesa.tamanhos[1].id, quantidade: 1, adicionais_ids: [] }],
  observacao: '',
}).senha_id);
senhaIds.push(criarPedido({
  senhaId: criarSenha().id,
  linhas: [{ item_id: chocolate.id, tamanho_id: chocolate.tamanhos[2].id, quantidade: 1, adicionais_ids: [chocolate.adicionais[1].id] }],
  observacao: '',
}).senha_id);
senhaIds.push(criarPedido({
  senhaId: criarSenha().id,
  linhas: [{ item_id: margherita.id, tamanho_id: margherita.tamanhos[1].id, quantidade: 2, adicionais_ids: [] }],
  observacao: '',
}).senha_id);
senhaIds.push(criarPedido({
  senhaId: criarSenha().id,
  linhas: [{ item_id: sucoLaranja.id, tamanho_id: sucoLaranja.tamanhos[0].id, quantidade: 3, adicionais_ids: [] }],
  observacao: 'Bem gelado',
}).senha_id);

console.log(`✓ ${1 + 1 + 4} senhas criadas (1 entregue, 1 pronta, 4 em preparação)`);

// ============= PROPAGANDAS =============
// A propaganda CodeGus já veio no seed automático do próprio módulo
// Adiciona uma segunda de exemplo (terceiro)
const props = listarPropagandas();
if (props.length < 2) {
  criarPropaganda({
    titulo: 'Ótica Bella Vista',
    subtitulo: 'Óculos de sol e grau — condições especiais',
    corpo: 'Rua das Flores, 123  ·  (47) 3321-4567',
    tipo: 'terceiro',
    ativa: true,
    ordem: 1,
  });
}

console.log('✓ 2 propagandas ativas (CodeGus + exemplo terceiro)');

console.log('\n✅ Banco populado com dados demo. Pronto pra captura.');
process.exit(0);
