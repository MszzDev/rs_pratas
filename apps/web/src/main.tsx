import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "./lib/query-client";
import { capturarCodigoDeAutorizacao } from "./features/settings/authorization-code";
import {
  aplicarPreferencias,
  lerPreferenciasGuardadas,
} from "./features/profile/apply-preferences";
import { VERSAO_DO_PACOTE } from "./lib/app-update";
import { ouvirConviteDeInstalacao, registrarServiceWorker } from "./lib/instalar";
import { vigiarConexao } from "./lib/conexao";
import { App } from "./App";
import "./index.css";

// Antes de montar qualquer tela: quem volta da autorização da Nuvemshop traz o
// código na barra de endereço, e o guarda de rota o jogaria fora ao mandar a
// pessoa para o login.
capturarCodigoDeAutorizacao();

// O tema antes da primeira pintura. A verdade vem do cadastro no login; esta
// é a cópia local, e existe só para quem escolheu a tela escura não levar um
// lampejo branco a cada abertura do aplicativo.
aplicarPreferencias(lerPreferenciasGuardadas());

// A versão fica pendurada na janela: é assim que se confere, de fora e sem
// cabo, se o tablet já trocou sozinho.
(window as unknown as { rsVersao?: string }).rsVersao = VERSAO_DO_PACOTE;

// O convite de instalação dispara UMA vez e cedo, antes de qualquer tela
// existir. Ouvir aqui é o que permite oferecer o botão depois; ouvir dentro de
// um componente perderia a única chance.
ouvirConviteDeInstalacao();
registrarServiceWorker();

// Uma vigilancia so, para o sistema inteiro. Cada tela perguntando por conta
// propria daria respostas diferentes ao mesmo tempo.
vigiarConexao();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
