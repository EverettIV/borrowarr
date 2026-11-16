"use client";
import React, { useState } from "react";
import Link from "next/link";
import {
  Film,
  Tv,
  Settings,
  User,
  Users,
  Database,
  Server,
  Heart,
  Coffee,
  Bitcoin,
  EyeOff,
  HardDrive,
  Inbox,
} from "lucide-react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@heroui/react";
import { Button } from "@heroui/react";
import { Snippet } from "@heroui/react";
import "../styles/Footer.scss";
import { BrandMark } from "@/components/BrandMark";

const EthIcon = ({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) => (
  <svg
    className={className}
    fill="currentColor"
    height={size}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z" />
  </svg>
);

const UsdcIcon = ({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) => (
  <svg
    className={className}
    fill="currentColor"
    height={size}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 24c6.627 0 12-5.373 12-12S18.627 0 12 0 0 5.373 0 12s5.373 12 12 12z"
      fill="#2775CA"
    />
    <path
      d="M12.75 15.75h-1.5v-1.5h1.5v1.5zm0-9h-1.5V5.25h1.5v1.5zm2.25 4.5c0 1.24-.92 2.25-2.05 2.25h-1.7v-1.5h1.7c.41 0 .75-.34.75-.75s-.34-.75-.75-.75h-1.7v-1.5h1.7c.41 0 .75-.34.75-.75s-.34-.75-.75-.75h-1.7V6.75h-1.5v.75h-1.5v1.5h1.5v6h-1.5v1.5h1.5v.75h1.5v-.75h1.7c1.13 0 2.05-1.01 2.05-2.25z"
      fill="white"
    />
  </svg>
);

const MoneroIcon = ({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) => (
  <svg
    className={className}
    fill="currentColor"
    height={size}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-.485 4.455h.97l5.703 5.703v8.497h-3.88v-5.67l-2.308 2.308-2.308-2.308v5.67H5.812v-8.497l5.703-5.703z"
      fill="#FF6600"
    />
  </svg>
);

const WALLET_ADDRESSES = {
  BTC: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  ETH: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  USDC: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  XMR: "44AFFq5kSiGBoZ4NMDwYtN187aarBFHRK1q31C31p79s5Bq6F644A3mZ67653434343",
};

const Footer = () => {
  const currentYear = new Date().getFullYear();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedCoin, setSelectedCoin] = useState<{
    name: string;
    symbol: string;
    address: string;
    icon: React.ReactNode;
  } | null>(null);

  const handleCryptoClick = (
    name: string,
    symbol: string,
    address: string,
    icon: React.ReactNode,
  ) => {
    setSelectedCoin({ name, symbol, address, icon });
    onOpen();
  };

  return (
    <footer className="Footer border-t-2 border-secondary bg-content1">
      <div className="footer-container">
        <div className="footer-section footer-brand">
          <Link
            className="brand-heading flex items-center gap-2.5 w-fit group"
            href="/pages/discover"
          >
            <BrandMark variant="footer" />
            <span className="font-bold text-xl sm:text-2xl bg-gradient-to-r from-secondary to-secondary-600 bg-clip-text text-transparent transition-transform group-hover:scale-[1.02]">
              BorrowArr
            </span>
          </Link>
          <p className="brand-description">
            Take control of your media library with powerful automation,
            beautiful discovery, and complete privacy.
          </p>
        </div>

        <div className="footer-section">
          <h4 className="section-title">Discover</h4>
          <ul className="section-links">
            <li>
              <Link className="footer-link" href="/pages/discover">
                <Tv size={16} />
                <span>Browse All</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/discover/movies">
                <Film size={16} />
                <span>Movies</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/discover/series">
                <Tv size={16} />
                <span>Series</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/monitored">
                <Film size={16} />
                <span>Monitored</span>
              </Link>
            </li>
          </ul>
        </div>

        <div className="footer-section">
          <h4 className="section-title">Settings</h4>
          <ul className="section-links">
            <li>
              <Link className="footer-link" href="/pages/indexers">
                <Database size={16} />
                <span>Indexers</span>
              </Link>
            </li>
            <li>
              <Link
                className="footer-link"
                href="/pages/settings/downloadclients"
              >
                <Settings size={16} />
                <span>Download Clients</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/system">
                <Server size={16} />
                <span>System</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/filemanagement">
                <HardDrive size={16} />
                <span>File Management</span>
              </Link>
            </li>
          </ul>
        </div>

        <div className="footer-section">
          <h4 className="section-title">Account</h4>
          <ul className="section-links">
            <li>
              <Link className="footer-link" href="/pages/medialibrary">
                <Server size={16} />
                <span>Media Library</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/login">
                <User size={16} />
                <span>Login</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/register">
                <User size={16} />
                <span>Register</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/users">
                <Users size={16} />
                <span>Users</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/requests">
                <Inbox size={16} />
                <span>Requests</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/favorites">
                <Heart size={16} />
                <span>Favorites</span>
              </Link>
            </li>
            <li>
              <Link className="footer-link" href="/pages/hiddenmedia">
                <EyeOff size={16} />
                <span>Hidden Media</span>
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-container">
          <div className="footer-support">
            <a
              className="footer-support-coffee"
              href="https://www.buymeacoffee.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Coffee size={16} />
              <span>Buy Me a Coffee</span>
            </a>
            <div
              aria-label="Donate cryptocurrency"
              className="footer-support-crypto"
              role="group"
            >
              <button
                className="footer-crypto-btn"
                onClick={() =>
                  handleCryptoClick(
                    "Bitcoin",
                    "BTC",
                    WALLET_ADDRESSES.BTC,
                    <Bitcoin className="text-[#F7931A]" size={18} />,
                  )
                }
                title="Donate Bitcoin"
                type="button"
              >
                <Bitcoin className="text-[#F7931A]" size={18} />
              </button>
              <button
                className="footer-crypto-btn"
                onClick={() =>
                  handleCryptoClick(
                    "Ethereum",
                    "ETH",
                    WALLET_ADDRESSES.ETH,
                    <EthIcon size={18} />,
                  )
                }
                title="Donate Ethereum"
                type="button"
              >
                <EthIcon size={18} />
              </button>
              <button
                className="footer-crypto-btn"
                onClick={() =>
                  handleCryptoClick(
                    "USDC",
                    "USDC",
                    WALLET_ADDRESSES.USDC,
                    <UsdcIcon size={18} />,
                  )
                }
                title="Donate USDC"
                type="button"
              >
                <UsdcIcon size={18} />
              </button>
              <button
                className="footer-crypto-btn"
                onClick={() =>
                  handleCryptoClick(
                    "Monero",
                    "XMR",
                    WALLET_ADDRESSES.XMR,
                    <MoneroIcon size={18} />,
                  )
                }
                title="Donate Monero"
                type="button"
              >
                <MoneroIcon size={18} />
              </button>
            </div>
          </div>

          <p className="copyright">
            <span>
              © {currentYear} BorrowArr. Built with
            </span>
            <Heart aria-hidden className="heart-icon" size={14} />
            <span>by developers, for developers.</span>
          </p>
          <p className="footer-disclaimer">
            BorrowArr does not host or supply media. You connect your own
            indexers and download clients and are responsible for lawful use.
          </p>
          <div className="footer-links-inline">
            <Link className="footer-link-small" href="/pages/privacy">
              Privacy
            </Link>
            <span className="separator">•</span>
            <Link className="footer-link-small" href="/pages/terms">
              Terms
            </Link>
            <span className="separator">•</span>
            <Link className="footer-link-small" href="/pages/docs">
              Docs
            </Link>
          </div>
        </div>
      </div>

      <Modal isOpen={isOpen} onClose={onClose} placement="center">
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  {selectedCoin?.icon}
                  <span>
                    Donate {selectedCoin?.name} ({selectedCoin?.symbol})
                  </span>
                </div>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-500 mb-2">
                  Copy the address below to donate. Thank you for your support!
                </p>
                <Snippet className="w-full" symbol="">
                  {selectedCoin?.address || "Address not set"}
                </Snippet>
              </ModalBody>
              <ModalFooter>
                <Button color="primary" onPress={onClose}>
                  Close
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </footer>
  );
};

export default Footer;