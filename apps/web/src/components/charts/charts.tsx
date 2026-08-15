import { useState } from "react";
import type { PointerEvent } from "react";
import { formatMoney } from "@/lib/money";

/**
 * Gráficos em SVG, sem biblioteca.
 *
 * São três formas simples — linha com área, barras horizontais e rosca — e
 * cada uma cabe em cem linhas. Trazer uma biblioteca de gráficos custaria
 * centenas de kB no pacote que o tablet baixa por uma rede de shopping, para
 * desenhar o que já está aqui.
 *
 * Todo gráfico traz também os números em texto: cor sozinha não informa quem
 * não distingue tons, e o tablet vive com brilho baixo e reflexo.
 */

export interface Point {
  label: string;
  value: number;
}

const ROSE = "#9B4F53";

/** Faturamento ao longo do tempo. Linha com área e barra de fundo. */
export function TrendChart({ data, title }: { data: Point[]; title?: string }) {
  const [active, setActive] = useState<number | null>(null);

  if (data.length === 0) {
    return <EmptyChart mensagem="Sem vendas no período." />;
  }

  const width = 720;
  const height = 240;
  const padding = 28;
  const maxValue = Math.max(...data.map((point) => point.value), 1);

  const points = data.map((point, index) => ({
    ...point,
    x: padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2),
    y: height - padding - (point.value / maxValue) * (height - padding * 2),
  }));

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const area = `${line} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;

  const activePoint = active === null ? null : points[active];
  const total = data.reduce((sum, point) => sum + point.value, 0);

  function handleMove(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * (points.length - 1)));
  }

  return (
    <div className="relative">
      {title && (
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-sm text-text-secondary">{title}</p>
          <p className="font-semibold text-text-primary">{formatMoney(String(total))}</p>
        </div>
      )}

      <div
        className="relative h-60"
        onPointerMove={handleMove}
        onPointerLeave={() => setActive(null)}
      >
        <svg
          className="h-full w-full"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Faturamento por período. Total de ${formatMoney(String(total))}.`}
        >
          <defs>
            <linearGradient id="trendArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={ROSE} stopOpacity="0.20" />
              <stop offset="100%" stopColor={ROSE} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={padding}
              x2={width - padding}
              y1={padding + ratio * (height - padding * 2)}
              y2={padding + ratio * (height - padding * 2)}
              stroke="#E7DFE0"
              strokeDasharray="4 6"
              strokeWidth="1"
            />
          ))}

          {points.map((point, index) => {
            const barWidth = (width - padding * 2) / Math.max(points.length * 1.8, 1);
            return (
              <rect
                key={`bar-${point.label}`}
                x={point.x - barWidth / 2}
                y={point.y}
                width={barWidth}
                height={height - padding - point.y}
                rx="4"
                fill={ROSE}
                opacity={active === index ? 0.28 : 0.12}
              />
            );
          })}

          <path d={area} fill="url(#trendArea)" />
          <path
            d={line}
            fill="none"
            stroke={ROSE}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {points.map((point) => (
            <circle
              key={point.label}
              cx={point.x}
              cy={point.y}
              r="3.5"
              fill="#FFFFFF"
              stroke={ROSE}
              strokeWidth="2"
            />
          ))}

          {activePoint && (
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={padding}
              y2={height - padding}
              stroke="#262323"
              strokeDasharray="4 5"
              strokeWidth="1.5"
            />
          )}
        </svg>

        {activePoint && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-32 rounded-md border border-border bg-surface p-3 shadow-lifted"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              transform: activePoint.x > width * 0.7 ? "translateX(-100%)" : "translateX(-10%)",
            }}
          >
            <p className="text-xs font-medium text-text-secondary">{activePoint.label}</p>
            <p className="mt-0.5 font-semibold text-rose-primary">
              {formatMoney(String(activePoint.value))}
            </p>
          </div>
        )}
      </div>

      <div className="mt-1 flex justify-between text-xs text-text-muted">
        {points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * Barras horizontais — vendas por loja, por vendedor, peças mais vendidas.
 *
 * Horizontal e não vertical porque os rótulos são nomes: "Juliana Prado" não
 * cabe embaixo de uma barra vertical sem virar de lado ou ser cortado.
 */
export function BarList({
  data,
  formatValue = (value: number) => formatMoney(String(value)),
}: {
  data: Point[];
  formatValue?: (value: number) => string;
}) {
  if (data.length === 0) {
    return <EmptyChart mensagem="Nada para mostrar no período." />;
  }

  const maxValue = Math.max(...data.map((point) => point.value), 1);

  return (
    <ul className="space-y-3">
      {data.map((point) => (
        <li key={point.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-text-primary">{point.label}</span>
            <span className="shrink-0 text-sm font-medium text-text-primary">
              {formatValue(point.value)}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-background-secondary"
            role="progressbar"
            aria-valuenow={Math.round((point.value / maxValue) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={point.label}
          >
            <div
              className="h-full rounded-full bg-rose-primary"
              style={{ width: `${Math.max(2, (point.value / maxValue) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Rosca — como o dinheiro entrou. Poucas fatias, cada uma com o valor ao lado. */
export function DonutChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return <EmptyChart mensagem="Nenhum pagamento no período." />;
  }

  const total = data.reduce((sum, point) => sum + point.value, 0);
  if (total === 0) {
    return <EmptyChart mensagem="Nenhum pagamento no período." />;
  }

  // Tons da mesma família, do mais escuro ao mais claro: cada fatia continua
  // distinguível em tela com brilho baixo, e o conjunto não vira arco-íris.
  const colors = ["#9B4F53", "#B8696D", "#C98F93", "#DDB3B6", "#EBD3D5", "#F4E8E9"];

  const radius = 60;
  const stroke = 22;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        width="160"
        height="160"
        viewBox="0 0 160 160"
        role="img"
        aria-label={`Distribuição por forma de pagamento, total de ${formatMoney(String(total))}.`}
      >
        <g transform="translate(80,80) rotate(-90)">
          {data.map((point, index) => {
            const fraction = point.value / total;
            const dash = fraction * circumference;
            const element = (
              <circle
                key={point.label}
                r={radius}
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return element;
          })}
        </g>
        <text
          x="80"
          y="76"
          textAnchor="middle"
          className="fill-text-secondary"
          style={{ fontSize: 11 }}
        >
          Total
        </text>
        <text
          x="80"
          y="94"
          textAnchor="middle"
          className="fill-text-primary"
          style={{ fontSize: 15, fontWeight: 600 }}
        >
          {formatMoney(String(total))}
        </text>
      </svg>

      <ul className="min-w-40 flex-1 space-y-2">
        {data.map((point, index) => (
          <li key={point.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-text-primary">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colors[index % colors.length] }}
                aria-hidden
              />
              {point.label}
            </span>
            <span className="shrink-0 text-text-secondary">
              {formatMoney(String(point.value))}
              <span className="ml-1 text-text-muted">
                ({Math.round((point.value / total) * 100)}%)
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyChart({ mensagem }: { mensagem: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-md bg-background-secondary text-sm text-text-muted">
      {mensagem}
    </div>
  );
}
