const { Client, LocalAuth } = require("whatsapp-web.js");
const path = require("path");
const schedule = require("node-schedule");
const qrcode = require("qrcode");
const { db } = require("../config/firebase"); // Importe o Firestore
const { matchTeams } = require("../services/apiFootballService");
const fs = require("fs-extra");

let isConnected = false;

const puppeteerOptions = {
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
};

// Inicializa o cliente
const client = new Client({
  authStrategy: new LocalAuth(), // Utiliza a estratégia de autenticação local para persistência de sessão
  puppeteer: puppeteerOptions,
});

const cacheDirectory = path.join(__dirname, "../.wwebjs_auth");
const webCache = path.join(__dirname, "../.wwebjs_cache");

let onAuthenticatedCallback = null;
let onDisconnectedCallback = null;

// Emissão de QR code após a inicialização do cliente
client.initialize();

const generateQRCode = () => {
  client.removeAllListeners("qr");
  return new Promise((resolve, reject) => {
    client.on("qr", (qr) => {
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          reject(err);
        } else {
          resolve(url);
          console.log("gerando Qrcode");
        }
      });
    });
  });
};

const initializeClientListeners = () => {
  client.removeAllListeners("authenticated");
  client.removeAllListeners("auth_failure");
  client.removeAllListeners("ready");
  client.removeAllListeners("disconnected");

  client.on("authenticated", () => {
    console.log("Cliente autenticado");
    isConnected = true;
    if (onAuthenticatedCallback) {
      onAuthenticatedCallback();
    }

    async function getAllDocuments() {
      try {
        // Consulta todos os documentos na coleção "messages"
        const snapshot = await db.collection("messages").get();
        // Verifica se há documentos
        if (snapshot.empty) {
          console.log("Nenhum documento encontrado.");
          return;
        }
        // Itera sobre os documentos e imprime seus dados
        snapshot.forEach(async (doc) => {
          const response = await matchTeams(doc.data().teamId);

          if (response === 404) return;

          const datetime = `${response.data_partida}T${response.hora_partida}`;

          scheduleMessage(
            doc.data().phoneNumber,
            new Date(datetime),
            response.partida_id,
            response.campeonato,
            response.placar,
            response.hora_partida,
            response.nome_estadio
          );
        });
      } catch (error) {
        console.error("Erro ao consultar documentos: ", error);
      }
    }
  });

  client.on("auth_failure", () => {
    console.error("Falha na autenticação");
    isConnected = false; // Atualiza o status de conexão
  });

  client.on("ready", () => {
    isConnected = true; // Atualiza o status de conexão
    console.log("Cliente está pronto para enviar mensagens");

    // Chama a função para obter todos os documentos
    //getAllDocuments();
  });

  client.on("disconnected", async (reason) => {
    console.log("Cliente desconectado:", reason);
    //isConnected = false; // Atualiza o status de conexão

    try {
      await Promise.all([fs.remove(cacheDirectory), fs.remove(webCache)]);
      console.log("cache removido com sucesso");
    } catch (error) {
      console.error("Erro ao remover cache:", error);
    }

    if (onDisconnectedCallback) {
      onDisconnectedCallback();
    }

    setTimeout(async () => {
      console.log("client inicializado apos desconectar");
      await client.initialize();
    }, 5000);
  });
};

initializeClientListeners();

// Função para enviar mensagens agendadas
const scheduleMessage = (
  phoneNumber,
  datetime,
  partida_id,
  campeonato,
  placar,
  hora_partida,
  nome_estadio
) => {
  console.log(datetime);
  console.log("mensagem agendada");
  schedule.scheduleJob(datetime, async () => {
    try {
      await client.sendMessage(
        phoneNumber,
        `*O seu time do coração ❤️ joga hoje*

👉 ${placar}
⏱️ ${hora_partida}
🏟️ ${nome_estadio}
🏆 ${campeonato}
          `
      );
      console.log(`Mensagem enviada para ${phoneNumber}`);

      // Apaga o documento do Firestore após o envio
      //await db.collection("messages").doc(docId).delete();
      //console.log(`Documento ${docId} removido do Firestore`);
    } catch (error) {
      console.error(`Falha ao enviar mensagem para ${phoneNumber}: ${error}`);
    }
  });
};

// Desconectar o cliente do WhatsApp
const disconnectClient = () => {
  return new Promise((resolve, reject) => {
    console.log(isConnected);
    if (isConnected) {
      client
        .logout()
        .then(async () => {
          isConnected = false; // Atualiza o status de conexão
          try {
            await Promise.all([fs.remove(cacheDirectory), fs.remove(webCache)]);
            console.log("cache removido com sucesso");
          } catch (error) {
            console.error("Erro ao remover cache:", error);
          }
          if (onDisconnectedCallback) {
            onDisconnectedCallback();
          }
          setTimeout(async () => {
            try {
              console.log("Inicializando cliente após desconectar");
              // Re-inicializar o cliente
              await client.initialize();
              resolve("Desconectado e reconectado com sucesso");
            } catch (error) {
              console.error("Erro ao inicializar cliente:", error);
              reject(error);
            }
          }, 5000);
          resolve("Desconectado com sucesso");
        })
        .catch((error) => {
          reject(error);
        });
    } else {
      resolve("Cliente já desconectado");
    }
  });
};

const onAuthenticated = (callback) => {
  onAuthenticatedCallback = callback;
};

const onDisconnected = (callback) => {
  onDisconnectedCallback = callback;
};

module.exports = {
  generateQRCode,
  scheduleMessage,
  onAuthenticated,
  onDisconnected,
  disconnectClient,
};
