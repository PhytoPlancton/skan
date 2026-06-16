import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "skan — veille logements ARPEJ",
  description:
    "Surveille les disponibilités des résidences ARPEJ et alerte dès qu'une place se libère.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
