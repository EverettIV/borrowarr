"use client";

import { Scale } from "lucide-react";
import NextLink from "next/link";
import {
  LegalPageShell,
  type LegalSection,
} from "@/components/legal/LegalPageShell";

const LAST_UPDATED = "November 15, 2026";

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement",
    content: (
      <>
        <p>
          These Terms of Use (&quot;Terms&quot;) apply to your use of BorrowArr
          software and any user interface served from an installation you access
          (&quot;the Service&quot; or &quot;the instance&quot;). If you do not
          agree, do not use the Service.
        </p>
        <p>
          The entity or person who deploys and administers an instance may impose
          additional rules for their users; those rules apply alongside these
          Terms where not inconsistent.
        </p>
      </>
    ),
  },
  {
    id: "what-borrowarr-is",
    title: "What BorrowArr is",
    content: (
      <>
        <p>
          BorrowArr is <strong>self-hosted management software</strong> in the
          same general category as Radarr, Sonarr, and Prowlarr. It helps you
          organize metadata, monitor titles, search configured indexers, queue
          grabs in download clients you operate, and manage files in your
          library.
        </p>
        <p>
          BorrowArr is a <strong>neutral tool</strong>. It does not provide,
          index, transmit, or store copyrighted media for end users as a
          service offering from the project authors.
        </p>
      </>
    ),
  },
  {
    id: "your-responsibilities",
    title: "Your responsibilities",
    content: (
      <>
        <p>You are solely responsible for:</p>
        <ul>
          <li>
            Configuring indexers, download clients, and storage paths you are
            authorized to use.
          </li>
          <li>
            Ensuring your use complies with applicable laws, including copyright
            and telecommunications rules in your jurisdiction.
          </li>
          <li>
            Honoring the terms of service of TMDb, Plex, Firebase, indexers,
            clients, and any other integrated products.
          </li>
          <li>
            Content acquired or imported through your setup—BorrowArr only
            automates workflows you define.
          </li>
        </ul>
        <p>
          See also the{" "}
          <NextLink className="text-secondary hover:underline" href="/pages/privacy">
            Privacy Policy
          </NextLink>{" "}
          for how instance data is handled.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts and access",
    content: (
      <>
        <p>
          Instances may require authentication. Keep credentials confidential.
          Admins may suspend or remove accounts that violate instance rules or
          these Terms.
        </p>
        <p>
          You must provide accurate account information where requested and
          notify an administrator of unauthorized access.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    content: (
      <>
        <p>You agree not to use BorrowArr to:</p>
        <ul>
          <li>Violate law or third-party rights.</li>
          <li>
            Probe, scan, or compromise indexers, clients, or networks without
            permission.
          </li>
          <li>
            Interfere with instance security or availability (for example,
            abusive API use or credential sharing in violation of admin policy).
          </li>
          <li>
            Misrepresent the Service as an official source of media or as
            operated by the open-source authors when it is your private
            deployment.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "third-party",
    title: "Third-party software and data",
    content: (
      <p>
        BorrowArr may include or support Cardigann-style indexer definitions,
        metadata from public APIs, and client integrations maintained by third
        parties. Those materials are subject to their own licenses and terms.
        The BorrowArr project does not endorse any particular indexer or source.
      </p>
    ),
  },
  {
    id: "disclaimer",
    title: "Disclaimer of warranties",
    content: (
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;
        WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING
        IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
        PURPOSE, AND NON-INFRINGEMENT. THE AUTHORS AND CONTRIBUTORS DO NOT
        WARRANT THAT THE SOFTWARE WILL BE ERROR-FREE, SECURE, OR UNINTERRUPTED.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    content: (
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL THE BORROWARR
        AUTHORS, CONTRIBUTORS, OR INSTANCE OPERATORS BE LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR
        ANY LOSS OF DATA, PROFITS, OR GOODWILL, ARISING FROM YOUR USE OF OR
        INABILITY TO USE THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF
        SUCH DAMAGES. YOUR SOLE REMEDY FOR DISSATISFACTION IS TO STOP USING THE
        SERVICE.
      </p>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnification",
    content: (
      <p>
        You agree to indemnify and hold harmless the BorrowArr authors,
        contributors, and (where applicable) instance operators from claims
        arising out of your use of the Service, your content choices, or your
        violation of these Terms or applicable law.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes",
    content: (
      <p>
        These Terms may be updated from time to time. Material changes will be
        reflected in the &quot;Last updated&quot; date. Continued use after
        changes constitutes acceptance for deployments that publish this text.
      </p>
    ),
  },
  {
    id: "governing-law",
    title: "Governing law",
    content: (
      <p>
        These Terms are provided as a template for self-hosted software.
        Instance operators may specify governing law and venue for their
        deployment. Where no operator terms exist, interpret disputes in good
        faith under generally applicable contract principles in your
        jurisdiction.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPageShell
      description="Terms for using BorrowArr on your infrastructure"
      icon={Scale}
      intro={
        <p>
          BorrowArr does not host media or operate indexers for you. These terms
          clarify the relationship between you, your instance, and the
          open-source software—aligned with how the *Arr ecosystem describes
          collection managers for Usenet and BitTorrent users.
        </p>
      }
      lastUpdated={LAST_UPDATED}
      sections={sections}
      title="Terms of Use"
    />
  );
}