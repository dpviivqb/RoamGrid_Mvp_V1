import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RoamGrid",
  description: "Turn your city into an open-world game."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
