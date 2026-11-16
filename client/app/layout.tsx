import "@/styles/globals.scss";
import { Metadata, Viewport } from "next";
import clsx from "clsx";
import { Providers } from "./providers";
import AuthRouter from "./authRouter";
import { AuthProvider } from "@/context/AuthContext";
import { fontSans } from "@/config/fonts";
import { AppChrome } from "@/components/AppChrome";
import { rootMetadata } from "@/lib/metadata";

export const metadata: Metadata = rootMetadata();

export const viewport: Viewport = {
  themeColor: [{ color: "#000000" }],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={clsx(
          "min-h-screen bg-background font-sans antialiased overflow-x-hidden",
          fontSans.variable,
        )}
      >
        <Providers>
          <AuthProvider>
            <AuthRouter>
              <AppChrome>{children}</AppChrome>
            </AuthRouter>
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
