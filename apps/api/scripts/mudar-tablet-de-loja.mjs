/**
 * Mover um tablet de uma loja para outra.
 *
 * O tablet não pertence só a uma loja: ele pertence a um CAIXA, que pertence a
 * uma ESTAÇÃO, que pertence à loja. Trocar só o `storeId` deixaria o aparelho
 * apontando para o caixa da loja antiga — e as vendas continuariam caindo lá,
 * em silêncio, o que é pior que não ter mudado nada.
 *
 * Por isso este script move a cadeia inteira, e se recusa a mover quando a loja
 * de destino não tem para onde receber.
 *
 * Sem `--aplicar` ele só mostra o que faria.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

function conexao() {
  const caminho = join(process.cwd(), "..", "..", ".env.backup");
  const b = readFileSync(caminho);
  const t = b.toString(b[0] === 0xff && b[1] === 0xfe ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
  return /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(t)[1].trim().replace(/^["']|["']$/g, "");
}

const APLICAR = process.argv.includes("--aplicar");
const DESTINO = "ITAQ";

const prisma = new PrismaClient({ datasources: { db: { url: conexao() } } });

const tablets = await prisma.device.findMany({
  where: { deletedAt: null, type: "TABLET" },
  select: {
    id: true,
    name: true,
    status: true,
    deviceUuid: true,
    lastSeenAt: true,
    store: { select: { code: true, name: true } },
    cashRegister: {
      select: { code: true, name: true, posStation: { select: { code: true, name: true } } },
    },
  },
});

console.log(`\n=== TABLETS CADASTRADOS: ${tablets.length} ===\n`);
for (const t of tablets) {
  console.log(`  ${t.name}  [${t.status}]`);
  console.log(`      loja:    ${t.store.code} — ${t.store.name}`);
  console.log(`      caixa:   ${t.cashRegister.posStation.code}/${t.cashRegister.code}`);
  console.log(`      pareado: ${t.deviceUuid ? "sim" : "NÃO"}`);
  console.log(`      visto:   ${t.lastSeenAt?.toLocaleString("pt-BR") ?? "nunca"}`);
}

const destino = await prisma.store.findFirst({
  where: { code: DESTINO, deletedAt: null },
  select: {
    id: true,
    name: true,
    posStations: {
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        code: true,
        cashRegisters: {
          where: { deletedAt: null, isActive: true },
          select: { id: true, code: true, name: true },
        },
      },
    },
  },
});

console.log(`\n=== DESTINO: ${DESTINO} ===\n`);
if (!destino) {
  console.log("  Loja não encontrada.");
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`  ${destino.name}`);
for (const estacao of destino.posStations) {
  console.log(`      estação ${estacao.code}: ${estacao.cashRegisters.length} caixa(s)`);
  for (const caixa of estacao.cashRegisters) console.log(`          ${caixa.code} — ${caixa.name}`);
}

let caixaDestino = destino.posStations.flatMap((e) => e.cashRegisters)[0];

/**
 * Loja nova não tem estação nem caixa, e criar isso é parte de abrir a loja —
 * não um pré-requisito burocrático para mexer no tablet.
 *
 * Os códigos seguem o padrão das outras (E01/C01): quem conferir uma loja
 * depois de conferir outra não deveria aprender uma convenção nova em cada uma.
 */
if (!caixaDestino) {
  if (!APLICAR) {
    console.log("\n  Itaquera não tem estação nem caixa — seriam criadas E01 e C01.");
  } else {
    const estacao =
      destino.posStations[0] ??
      (await prisma.pOSStation.create({
        data: { storeId: destino.id, code: "E01", name: "Estação E01" },
      }));

    caixaDestino = await prisma.cashRegister.create({
      data: { posStationId: estacao.id, code: "C01", name: "Caixa C01" },
      select: { id: true, code: true, name: true, posStationId: true },
    });

    console.log(`\n  criados em ${destino.name}: estação ${estacao.code}, caixa ${caixaDestino.code}`);
  }
}

/**
 * O tablet que está EM USO, e não o primeiro da lista.
 *
 * Há quatro cadastrados, e três são restos de demonstração numa loja "Centro"
 * que não existe na rede — sem pareamento, nunca vistos. Mover um deles não
 * daria erro nenhum e também não moveria o aparelho que está no balcão, que é o
 * tipo de silêncio que só aparece quando a loja tenta vender.
 */
const tablet = tablets.find((t) => t.status === "ACTIVE" && t.deviceUuid) ?? null;
if (!tablet) {
  console.log("\n  Nenhum tablet para mover.\n");
  await prisma.$disconnect();
  process.exit(1);
}

// Caixa aberto na loja de origem é dinheiro em contagem. Mover o tablet no meio
// disso deixaria a sessão sem o aparelho que a abriu.
const sessaoAberta = await prisma.cashSession.findFirst({
  where: { cashRegister: { devices: { some: { id: tablet.id } } }, status: "ABERTO" },
  select: { openedAt: true },
});

console.log(`\n=== O QUE VAI ACONTECER ===\n`);
console.log(`  tablet:  ${tablet.name}`);
console.log(`  de:      ${tablet.store.code} (${tablet.cashRegister.posStation.code}/${tablet.cashRegister.code})`);
// Na simulação o caixa ainda não existe — ele só é criado ao aplicar.
console.log(`  para:    ${DESTINO} (${caixaDestino?.code ?? "C01, a criar"})`);
console.log(`  caixa aberto na origem: ${sessaoAberta ? `SIM, desde ${sessaoAberta.openedAt.toLocaleString("pt-BR")}` : "não"}`);

if (sessaoAberta) {
  console.log("\n  RECUSADO: feche o caixa da loja de origem antes de mover.\n");
  await prisma.$disconnect();
  process.exit(1);
}

/**
 * A maquininha fica para trás, desvinculada.
 *
 * Ela é do TABLET: o cadastro guarda loja, estação e caixa copiados da cadeia
 * do aparelho. Arrastá-la junto levaria para Itaquera uma maquininha do Mercado
 * Pago que vai continuar fisicamente em Elis Maas — e a conferência passaria a
 * procurar em Itaquera pagamentos que entraram na outra loja, acusando falta de
 * dinheiro que não faltou.
 *
 * `deviceId` é obrigatório no cadastro, então desvincular é encerrar o registro
 * e não esvaziar o campo. A maquininha continua cobrando normalmente no balcão;
 * o que se perde é a conferência automática dela, que volta quando ela for
 * cadastrada no tablet que ficar em Elis.
 */
const maquininhas = await prisma.paymentTerminal.findMany({
  where: { deviceId: tablet.id, deletedAt: null },
  select: { id: true, provider: true, serialNumber: true },
});

console.log(`  maquininhas vinculadas a este tablet: ${maquininhas.length}`);
for (const m of maquininhas) {
  console.log(`      ${m.provider ?? "sem provedor"} ${m.serialNumber ?? ""} — será desvinculada`);
}

if (!APLICAR) {
  console.log("\n  (simulação — rode com --aplicar para gravar)\n");
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.device.update({
  where: { id: tablet.id },
  data: { storeId: destino.id, cashRegisterId: caixaDestino.id },
});

if (maquininhas.length > 0) {
  await prisma.paymentTerminal.updateMany({
    where: { id: { in: maquininhas.map((m) => m.id) } },
    data: { deletedAt: new Date() },
  });
  console.log(`  ${maquininhas.length} maquininha(s) desvinculada(s).`);
}

console.log(`\n  >>> MOVIDO para ${destino.name} <<<\n`);

await prisma.$disconnect();
