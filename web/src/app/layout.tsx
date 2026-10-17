import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/*
 * Type pairing deviates from the skill's crypto/web3 suggestion (Orbitron +
 * Exo 2) on purpose. STYX documentation is deliberately sober and anti-hype,
 * and a futuristic display face would undercut the credibility the project
 * depends on. Inter plus a monospace for data matches the Swiss-minimal
 * direction the same design system selected.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "STYX — Reparto justo de entradas, verificable en la cadena",
  description:
    "STYX sustituye la cola por orden de llegada por una ventana de cualificacion y un sorteo verificable, e identifica enjambres coordinados analizando datos que la cadena registra de forma nativa.",
  metadataBase: new URL("https://styx.invalid"),
  openGraph: {
    title: "STYX — Reparto justo de entradas",
    description:
      "La velocidad no aporta ninguna ventaja, por construccion. Construido sobre Monad.",
    locale: "es_ES",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
