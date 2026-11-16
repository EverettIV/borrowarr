"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardBody } from "@heroui/react";
import { PageContent, PageHeader } from "@/components/page-header";

export type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type LegalPageShellProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  lastUpdated: string;
  intro?: ReactNode;
  sections: LegalSection[];
};

export function LegalPageShell({
  title,
  description,
  icon: Icon,
  lastUpdated,
  intro,
  sections,
}: LegalPageShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        description={description}
        icon={<Icon className="h-6 w-6" />}
        title={title}
      />
      <PageContent>
        <div className="max-w-3xl mx-auto space-y-6 pb-12">
          <p className="text-sm text-foreground/50 text-center">
            Last updated: {lastUpdated}
          </p>

          {intro && (
            <Card className="border border-secondary/20 bg-content1">
              <CardBody className="p-6 text-foreground/80 leading-relaxed">
                {intro}
              </CardBody>
            </Card>
          )}

          <nav
            aria-label="On this page"
            className="rounded-xl border border-secondary/20 bg-content1/50 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50 mb-2">
              On this page
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    className="text-secondary hover:underline"
                    href={`#${section.id}`}
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {sections.map((section) => (
            <Card
              className="border border-secondary/20 bg-content1 scroll-mt-24"
              id={section.id}
              key={section.id}
            >
              <CardBody className="p-6 sm:p-8 space-y-4">
                <h2 className="text-xl font-semibold text-foreground">
                  {section.title}
                </h2>
                <div className="text-foreground/80 leading-relaxed space-y-4 text-sm sm:text-base [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_a]:text-secondary [&_a]:hover:underline">
                  {section.content}
                </div>
              </CardBody>
            </Card>
          ))}

          <p className="text-xs text-foreground/45 text-center px-4">
            This page is provided for transparency and does not constitute legal
            advice. If you operate BorrowArr for others, consult qualified counsel
            for your jurisdiction.
          </p>
        </div>
      </PageContent>
    </div>
  );
}