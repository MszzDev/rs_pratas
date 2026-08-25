-- Identificador da maquininha na API do Point.
--
-- É o que permite mandar o valor da venda direto para a tela do aparelho, em
-- vez de alguém digitar. O que isso resolve não é conforto: é R$ 189,90 virando
-- R$ 18,99 na pressa do fim de tarde — e o número do pagamento voltando sozinho,
-- que é o que faz o estorno e a conferência do caixa funcionarem.
ALTER TABLE "payment_terminals" ADD COLUMN "mpDeviceId" TEXT;
