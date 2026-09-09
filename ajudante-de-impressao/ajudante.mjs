/**
 * O ajudante de impressão da RS Pratas.
 *
 * Um programa pequeno que fica no computador da loja e faz **uma coisa só**:
 * recebe os bytes de uma etiqueta e entrega na impressora, na porta 9100.
 *
 * ## Por que ele existe
 *
 * O navegador não pode abrir conexão de rede numa porta como a 9100 — é
 * proibido por segurança, em todos eles. Então a única forma de imprimir do
 * navegador é pelo diálogo de impressão, que passa pelo driver do Windows.
 *
 * Essa passagem é onde a loja perdeu dias. O navegador escolhe o papel, aplica
 * margem, escala o desenho para caber e cria páginas por conta própria; o
 * driver acrescenta a própria ideia de área imprimível. Nenhuma dessas decisões
 * é deles para tomar quando o papel tem 33 mm e vem picotado — e cada página a
 * mais é uma etiqueta desperdiçada.
 *
 * Falando direto com a impressora, o sistema diz a medida em milímetros e ela
 * obedece. Foi assim que as etiquetas saíram certas de primeira, todas as vezes.
 *
 * ## Por que ele é burro de propósito
 *
 * Ele não sabe o que é uma etiqueta. Não faz conta de milímetro, não conhece
 * modelo, não desenha nada. Quem desenha é o sistema, que já tem o editor, as
 * medidas e a régua na tela — e o navegador faz isso muito bem, porque desenhar
 * é justamente o que ele sabe.
 *
 * Isso mantém o ajudante pequeno e estável: mudar o desenho da etiqueta não
 * pede nova versão dele, e ele não tem como estragar o que recebe.
 */
import { createServer } from "node:http";
import { connect } from "node:net";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(AQUI, "impressora.json");

/**
 * A porta em que o ajudante ouve.
 *
 * Só em 127.0.0.1: quem manda é o navegador desta máquina, e abrir para a rede
 * deixaria qualquer aparelho da loja imprimir sem passar pelo sistema.
 */
const PORTA_DO_AJUDANTE = 9110;

function lerConfig() {
  if (!existsSync(CONFIG)) {
    return { ip: "192.168.15.240", porta: 9100 };
  }
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    return { ip: "192.168.15.240", porta: 9100 };
  }
}

function gravarConfig(config) {
  writeFileSync(CONFIG, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Entrega os bytes na impressora e espera ela aceitar.
 *
 * O `await` importa: sem ele, a resposta ao navegador diria "enviado" antes de
 * a impressora ter recebido, e um erro de rede viraria silêncio. Quem clicou
 * precisa saber se o papel vai sair.
 */
function entregar(bytes, { ip, porta }) {
  return new Promise((resolver, recusar) => {
    const socket = connect({ host: ip, port: porta, timeout: 10_000 });

    socket.on("connect", () => {
      socket.write(bytes, () => {
        // Um instante antes de fechar: fechar no mesmo tique às vezes corta o
        // último pedaço antes de a impressora ler tudo.
        setTimeout(() => socket.end(), 400);
      });
    });

    socket.on("close", () => resolver({ ok: true, bytes: bytes.length }));

    socket.on("timeout", () => {
      socket.destroy();
      recusar(new Error("A impressora não respondeu. Confira se está ligada e na rede."));
    });

    socket.on("error", (erro) => {
      socket.destroy();
      recusar(
        new Error(
          erro.code === "ECONNREFUSED"
            ? "A impressora recusou a conexão. Confira o endereço e se a porta é 9100."
            : `Não deu para falar com a impressora: ${erro.message}`,
        ),
      );
    });
  });
}

function responder(res, status, corpo) {
  const texto = JSON.stringify(corpo);

  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(texto),
    /**
     * O sistema roda em outro endereço, então o navegador pede permissão antes
     * de mandar. Sem isto ele recusa sozinho, sem nem tentar.
     */
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-max-age": "86400",
  });

  res.end(texto);
}

function lerCorpo(req) {
  return new Promise((resolver, recusar) => {
    const partes = [];
    let tamanho = 0;

    req.on("data", (parte) => {
      tamanho += parte.length;

      // Uma etiqueta desenhada ponto a ponto tem alguns KB; um lote grande,
      // alguns MB. Acima disso é engano, e engolir sem limite trava a máquina.
      if (tamanho > 20 * 1024 * 1024) {
        recusar(new Error("Conteúdo grande demais."));
        req.destroy();
        return;
      }

      partes.push(parte);
    });

    req.on("end", () => resolver(Buffer.concat(partes)));
    req.on("error", recusar);
  });
}

const servidor = createServer(async (req, res) => {
  // A pergunta que o navegador faz antes de mandar.
  if (req.method === "OPTIONS") {
    responder(res, 204, {});
    return;
  }

  /** Serve para o sistema saber que o ajudante está de pé, e em qual impressora. */
  if (req.method === "GET" && req.url === "/situacao") {
    const config = lerConfig();
    responder(res, 200, { ok: true, versao: 1, impressora: config });
    return;
  }

  if (req.method === "POST" && req.url === "/impressora") {
    try {
      const corpo = JSON.parse((await lerCorpo(req)).toString("utf8"));
      const config = {
        ip: String(corpo.ip ?? "").trim(),
        porta: Number(corpo.porta) || 9100,
      };

      if (!config.ip) {
        responder(res, 400, { ok: false, erro: "Falta o endereço da impressora." });
        return;
      }

      gravarConfig(config);
      console.log(`Impressora agora é ${config.ip}:${config.porta}`);
      responder(res, 200, { ok: true, impressora: config });
    } catch (erro) {
      responder(res, 400, { ok: false, erro: erro.message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/imprimir") {
    try {
      const corpo = JSON.parse((await lerCorpo(req)).toString("utf8"));

      if (!corpo.conteudo) {
        responder(res, 400, { ok: false, erro: "Nada para imprimir." });
        return;
      }

      // Chega em base64 porque é o formato que atravessa JSON sem se estragar:
      // os comandos da impressora têm bytes que não são texto.
      const bytes = Buffer.from(corpo.conteudo, "base64");
      const config = corpo.impressora?.ip ? corpo.impressora : lerConfig();

      const resultado = await entregar(bytes, config);
      console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${resultado.bytes} bytes entregues`);
      responder(res, 200, { ok: true, ...resultado });
    } catch (erro) {
      console.error(`${new Date().toLocaleTimeString("pt-BR")}  FALHOU: ${erro.message}`);
      responder(res, 502, { ok: false, erro: erro.message });
    }
    return;
  }

  responder(res, 404, { ok: false, erro: "Não existe." });
});

servidor.listen(PORTA_DO_AJUDANTE, "127.0.0.1", () => {
  const config = lerConfig();
  console.log("Ajudante de impressão da RS Pratas");
  console.log(`  ouvindo em  http://127.0.0.1:${PORTA_DO_AJUDANTE}`);
  console.log(`  impressora  ${config.ip}:${config.porta}`);
  console.log("");
  console.log("Deixe esta janela aberta enquanto for imprimir etiqueta.");
});
