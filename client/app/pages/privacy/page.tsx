"use client";

import NextLink from "next/link";
import { Shield } from "lucide-react";
import {
  LegalPageShell,
  type LegalSection,
} from "@/components/legal/LegalPageShell";

const LAST_UPDATED = "November 15, 2026";

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "Scope",
    content: (
      <>
        <p>
          This Privacy Policy describes how data is handled when you run{" "}
          <strong>BorrowArr</strong> on infrastructure you control (or that
          someone operates for you with your permission). BorrowArr is
          self-hosted software; the project authors do not operate a central
          BorrowArr cloud that stores your media, indexer credentials, or
          download history unless you explicitly choose a third-party hosting
          arrangement outside this repository.
        </p>
        <p>
          By creating an account on an instance or using the application, you
          acknowledge that the <strong>instance operator</strong> (often you) is
          responsible for protecting data stored on that server.
        </p>
      </>
    ),
  },
  {
    id: "data-we-store",
    title: "Data stored on your instance",
    content: (
      <>
        <p>
          BorrowArr persists information needed to manage your library workflow,
          which may include:
        </p>
        <ul>
          <li>
            <strong>Account data</strong> — usernames, password hashes, roles,
            and permissions (when local/JWT auth is used).
          </li>
          <li>
            <strong>Configuration</strong> — quality profiles, paths, indexer
            and download client settings, API keys you enter, and automation
            preferences.
          </li>
          <li>
            <strong>Operational data</strong> — monitored titles (metadata
            references such as TMDb IDs), request history, activity logs, rename
            history, and similar records stored in the local database.
          </li>
          <li>
            <strong>Session data</strong> — tokens in browser storage when you
            sign in, so the client can call your instance API.
          </li>
        </ul>
        <p>
          BorrowArr does <strong>not</strong> supply or host media files. Files
          remain on disks, Plex, or clients you configure.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services you connect",
    content: (
      <>
        <p>
          When you enable integrations, those providers receive requests from{" "}
          <em>your</em> server according to their own policies, for example:
        </p>
        <ul>
          <li>
            <strong>Metadata</strong> — TMDb, IMDb-related features, and similar
            APIs for posters, descriptions, and IDs.
          </li>
          <li>
            <strong>Authentication</strong> — Firebase or other identity
            providers, if configured for your instance.
          </li>
          <li>
            <strong>Media servers</strong> — Plex or compatible APIs when you
            link a server.
          </li>
          <li>
            <strong>Indexers and download clients</strong> — Torznab/Newznab
            indexers, BitTorrent/Usenet clients, Prowlarr, FlareSolverr, and
            related endpoints you add. Credentials are stored on your instance
            and used only to perform actions you initiate.
          </li>
        </ul>
        <p>
          Review each third party&apos;s privacy policy and terms. BorrowArr
          authors are not responsible for data flows between your instance and
          services you choose to integrate.
        </p>
      </>
    ),
  },
  {
    id: "no-central-collection",
    title: "What we do not collect centrally",
    content: (
      <>
        <p>
          Open-source/self-hosted use of BorrowArr does not, by default, send
          your library activity, indexer credentials, or download history to
          the BorrowArr maintainers. There is no built-in phone-home analytics
          in the core application described in this repository.
        </p>
        <p>
          If you clone, fork, or deploy a modified build, your modifications may
          change this behavior—you are responsible for disclosing that to your
          users.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security and retention",
    content: (
      <>
        <p>
          Protect your instance with strong passwords, TLS on public endpoints,
          firewalls, and regular backups. Limit admin access and rotate API keys
          for indexers and clients.
        </p>
        <p>
          Retention is under your control: uninstalling the app or deleting the
          database removes BorrowArr&apos;s stored records on that server (subject
          to your backup practices).
        </p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    content: (
      <>
        <p>
          Because data lives on your instance, exercise access, correction, or
          deletion by using in-app tools (where available), contacting your
          instance administrator, or removing data directly from the server
          database and filesystem.
        </p>
        <p>
          Regional privacy laws (for example GDPR or CCPA) may apply to how{" "}
          <em>you</em> process personal data if you host BorrowArr for a
          household, friends, or an organization. This policy does not replace
          your obligations as a data controller in those cases.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    content: (
      <p>
        BorrowArr is not directed at children under 13. Instance operators
        should not create accounts for children without appropriate parental
        consent and safeguards required by local law.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    content: (
      <p>
        We may update this page when practices or features change. The &quot;Last
        updated&quot; date at the top will reflect substantive edits. Continued
        use after changes constitutes acceptance of the revised policy for
        users of deployments that publish this text.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    content: (
      <>
        <p>
          For privacy questions about the BorrowArr project, use the contact method
          published with your distribution (for example, the repository issue
          tracker or support channel listed in the README). For data held on a
          specific instance, contact that instance&apos;s administrator.
        </p>
        <p>
          See also our{" "}
          <NextLink className="text-secondary hover:underline" href="/pages/terms">
            Terms of Use
          </NextLink>
          .
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPageShell
      description="How data is handled on your self-hosted BorrowArr instance"
      icon={Shield}
      intro={
        <p>
          BorrowArr is collection-management software for Usenet and BitTorrent
          workflows. It does not host media. This policy explains what the
          application may store locally and what happens when you connect
          external services.
        </p>
      }
      lastUpdated={LAST_UPDATED}
      sections={sections}
      title="Privacy Policy"
    />
  );
}