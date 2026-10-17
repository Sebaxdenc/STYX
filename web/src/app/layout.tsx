import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppHeader } from "@/components/app-header";
import { WalletProvider } from "@/hooks/use-wallet";
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
    "La cualificación ocurre en una ventana amplia y las entradas se asignan por sorteo verificable. La velocidad no confiere ninguna ventaja, por construcción.",
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
        <WalletProvider>
          <AppHeader />
          <main id="contenido" className="mx-auto w-full max-w-5xl px-6 py-12 md:py-16">
            {children}
          </main>
        </WalletProvider>
      </body>
    </html>
  );
}
