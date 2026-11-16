"use client";

import NextLink from "next/link";
import { BookOpen, FileText, Shield, Scale } from "lucide-react";
import { Card, CardBody } from "@heroui/react";
import { PageContent, PageHeader } from "@/components/page-header";

const links = [
  {
    title: "Terms of Use",
    description: "Neutral-tool terms, acceptable use, and disclaimers.",
    href: "/pages/terms",
    icon: Scale,
    external: false,
  },
  {
    title: "Privacy Policy",
    description: "What BorrowArr stores on your instance and third-party flows.",
    href: "/pages/privacy",
    icon: Shield,
    external: false,
  },
];

function DocLinkCard({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof Scale;
}) {
  return (
    <Card className="border border-secondary/20 bg-content1 hover:border-secondary/40 transition-colors">
      <CardBody className="p-5 flex flex-row gap-4 items-start">
        <div className="p-2 rounded-lg bg-secondary/10 text-secondary shrink-0">
          <Icon size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-foreground/60 mt-1">{description}</p>
        </div>
      </CardBody>
    </Card>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        description="Guides and policies for your BorrowArr deployment"
        icon={<BookOpen className="h-6 w-6" />}
        title="Documentation"
      />
      <PageContent>
        <div className="max-w-2xl mx-auto space-y-4 pb-12">
          <p className="text-foreground/70 text-sm sm:text-base text-center">
            BorrowArr is self-hosted. Use the policies below on any instance you
            operate. Setup and architecture details are in the{" "}
            <code className="text-xs bg-content2 px-1.5 py-0.5 rounded">
              README.md
            </code>{" "}
            at the root of your deployment.
          </p>
          {links.map((item) =>
            item.external ? (
              <a
                className="block"
                href={item.href}
                key={item.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                <DocLinkCard
                  description={item.description}
                  icon={item.icon}
                  title={item.title}
                />
              </a>
            ) : (
              <NextLink className="block" href={item.href} key={item.href}>
                <DocLinkCard
                  description={item.description}
                  icon={item.icon}
                  title={item.title}
                />
              </NextLink>
            ),
          )}
          <Card className="border border-dashed border-secondary/30 bg-content1/50">
            <CardBody className="p-5 flex flex-row gap-4 items-start">
              <div className="p-2 rounded-lg bg-secondary/10 text-secondary shrink-0">
                <FileText size={22} />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Operator note</h2>
                <p className="text-sm text-foreground/60 mt-1">
                  Replace or extend this page with links to your own runbooks,
                  backup procedures, and support contacts when you deploy for a
                  household or organization.
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </PageContent>
    </div>
  );
}