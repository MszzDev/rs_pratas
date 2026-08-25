import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "./lib/query-client";
import { capturarCodigoDeAutorizacao } from "./features/settings/authorization-code";
import { App } from "./App";
import "./index.css";

// Antes de montar qualquer tela: quem volta da autorização da Nuvemshop traz o
// código na barra de endereço, e o guarda de rota o jogaria fora ao mandar a
// pessoa para o login.
capturarCodigoDeAutorizacao();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
