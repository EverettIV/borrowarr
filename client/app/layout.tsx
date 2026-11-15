import "@/styles/globals.scss";
import { Metadata, Viewport } from "next";
import clsx from "clsx";
import { Providers } from "./providers";
import AuthRouter from "./authRouter";
import Footer from "@/components/footer";
import { AuthProvider } from "@/context/AuthContext";
import { fontSans } from "@/config/fonts";
import { Navbar } from "@/components/navbar";
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
              <div className="relative flex flex-col min-h-screen min-w-0 w-full overflow-x-hidden">
                <div className="fixed top-0 left-0 right-0 z-[9999]">
                  <Navbar />
                </div>
                <main className="container mx-auto max-w-7xl pt-16 px-6 flex-grow overflow-x-hidden w-full">
                  {children}
                </main>
                <Footer />
              </div>
            </AuthRouter>
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
