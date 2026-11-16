"use client";
import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@heroui/react";
import { YLogoLoader } from "@/components/YLogoLoader";
import { Card, CardBody } from "@heroui/react";
import { Chip } from "@heroui/react";
import { Input } from "@heroui/react";
import { Select, SelectItem } from "@heroui/react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from "@heroui/react";
import {
  Film,
  Star,
  Trash2,
  Download,
  Eye,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  X,
  Filter,
  Check,
  Tv,
} from "lucide-react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ScrollToTop } from "@/components/ScrollToTop";
import { PageContent, PageHeader } from "@/components/page-header";
import "../../../styles/Monitored.scss";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

interface MonitoredMovie {
  id: number;
  userId: string;
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  overview: string | null;
  qualityProfile: string;
  minAvailability: string;
  monitor: string;
  status: "monitoring" | "downloading" | "downloaded" | "error" | "missing";
  downloadedTorrentId: string | null;
  downloadedTorrentTitle: string | null;
  fileExists: boolean;
  filePath: string | null;
  fileName: string | null;
  fileSize: number | null;
  lastChecked: string | null;
  createdAt: string;
  updatedAt: string;
  ownerUsername?: string | null;
  type?: "movie";
}

interface MonitoredSeries {
  id: number;
  userId: string;
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  firstAirDate: string | null;
  overview: string | null;
  qualityProfile: string;
  minAvailability: string;
  monitor: string;
  status: "monitoring" | "downloading" | "downloaded" | "error";
  selectedSeasons: string | null;
  selectedEpisodes: string | null;
  createdAt: string;
  updatedAt: string;
  ownerUsername?: string | null;
  type?: "series";
}

type MonitoredItem = MonitoredMovie | MonitoredSeries;

interface TorrentResult {
  id: string;
  protocol: "torrent" | "nzb";
  age: number;
  ageFormatted: string;
  title: string;
  indexer: string;
  indexerId: number;
  size: number;
  sizeFormatted: string;
  grabs: number;
  seeders: number | null;
  leechers: number | null;
  downloadUrl: string;
}

const Monitored = () => {
  const { user, loading: loadingAuth } = useAuth();
  const router = useRouter();

  const [movies, setMovies] = useState<MonitoredMovie[]>([]);
  const [series, setSeries] = useState<MonitoredSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Set<number>>(new Set());
  const [deletingSeries, setDeletingSeries] = useState<Set<number>>(new Set());
  const [requesting, setRequesting] = useState<Set<number>>(new Set());
  const [requestingSeries, setRequestingSeries] = useState<Set<number>>(
    new Set(),
  );

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [qualityFilter, setQualityFilter] = useState<string>("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<string>("all");

  // Download modal state
  const {
    isOpen: isDownloadModalOpen,
    onOpen: onDownloadModalOpen,
    onClose: onDownloadModalClose,
  } = useDisclosure();
  const [selectedMovieForDownload, setSelectedMovieForDownload] =
    useState<MonitoredMovie | null>(null);
  const [torrents, setTorrents] = useState<TorrentResult[]>([]);
  const [loadingTorrents, setLoadingTorrents] = useState(false);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [downloadSuccess, setDownloadSuccess] = useState<Set<string>>(
    new Set(),
  );
  const [downloadError, setDownloadError] = useState<Map<string, string>>(
    new Map(),
  );
  const [openSelects, setOpenSelects] = useState<Set<string>>(new Set());

  // Movie settings state for editing
  const [editMonitor, setEditMonitor] = useState("movieOnly");
  const [editMinAvailability, setEditMinAvailability] = useState("released");
  const [editQualityProfile, setEditQualityProfile] = useState("any");
  const [updatingSettings, setUpdatingSettings] = useState(false);

  useEffect(() => {
    if (!loadingAuth) {
      if (!user) {
        router.push("/pages/login");
        return;
      }
      fetchMonitoredContent();
    }
  }, [user, loadingAuth, router]);

  const isAdmin = Boolean(user?.permissions?.admin);

  const monitoredAuthHeaders = () => {
    const token = localStorage.getItem("accessToken");
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  };

  const fetchMonitoredContent = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const listParams: Record<string, string> = { userId: user.id };
      if (isAdmin) {
        listParams.scope = "all";
      }
      const [moviesResponse, seriesResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/MonitoredMovies`, {
          params: listParams,
          headers: monitoredAuthHeaders(),
        }),
        axios.get(`${API_BASE_URL}/api/MonitoredSeries`, {
          params: listParams,
          headers: monitoredAuthHeaders(),
        }),
      ]);
      setMovies(
        (moviesResponse.data.movies || []).map((m: MonitoredMovie) => ({
          ...m,
          type: "movie",
        })),
      );
      setSeries(
        (seriesResponse.data.series || []).map((s: MonitoredSeries) => ({
          ...s,
          type: "series",
        })),
      );
    } catch (error) {
      console.error("Error fetching monitored content:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMovie = async (movie: MonitoredMovie) => {
    if (!user) return;

    if (
      !confirm("Are you sure you want to remove this movie from monitoring?")
    ) {
      return;
    }

    setDeleting((prev) => new Set(prev).add(movie.id));

    try {
      await axios.delete(`${API_BASE_URL}/api/MonitoredMovies/${movie.id}`, {
        params: { userId: movie.userId },
        headers: monitoredAuthHeaders(),
      });
      setMovies((prev) => prev.filter((m) => m.id !== movie.id));
    } catch (error) {
      console.error("Error removing movie:", error);
      alert("Failed to remove movie from monitoring");
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(movie.id);
        return next;
      });
    }
  };

  const handleRemoveSeries = async (seriesItem: MonitoredSeries) => {
    if (!user) return;

    if (
      !confirm("Are you sure you want to remove this series from monitoring?")
    ) {
      return;
    }

    setDeletingSeries((prev) => new Set(prev).add(seriesItem.id));

    try {
      await axios.delete(`${API_BASE_URL}/api/MonitoredSeries/${seriesItem.id}`, {
        params: { userId: seriesItem.userId },
        headers: monitoredAuthHeaders(),
      });
      setSeries((prev) => prev.filter((s) => s.id !== seriesItem.id));
    } catch (error) {
      console.error("Error removing series:", error);
      alert("Failed to remove series from monitoring");
    } finally {
      setDeletingSeries((prev) => {
        const next = new Set(prev);
        next.delete(seriesItem.id);
        return next;
      });
    }
  };

  const handleRequestMovie = async (movie: MonitoredMovie) => {
    if (!user) return;

    const movieId = movie.id;
    setRequesting((prev) => new Set(prev).add(movieId));

    try {
      const token = localStorage.getItem("accessToken");
      const { grabMonitoredMovie } = await import("@/lib/monitoring");
      const response = await grabMonitoredMovie(movie.id, token);
      const msg = response.result?.message || `Grab started for ${movie.title}`;
      await fetchMonitoredContent();
      alert(response.result?.grab ? `Queued: ${movie.title}` : msg);
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.error || error.message || "Request failed";
      alert(`Error: ${errorMsg}`);
    } finally {
      setRequesting((prev) => {
        const next = new Set(prev);
        next.delete(movieId);
        return next;
      });
    }
  };

  const handleRequestSeries = async (series: MonitoredSeries) => {
    if (!user) return;

    const seriesId = series.id;
    setRequestingSeries((prev) => new Set(prev).add(seriesId));

    try {
      const token = localStorage.getItem("accessToken");
      const { grabMonitoredSeries } = await import("@/lib/monitoring");
      const response = await grabMonitoredSeries(series.id, token);
      await fetchMonitoredContent();
      const grabbed = response.result?.episodesGrabbed ?? 0;
      alert(
        grabbed > 0
          ? `Queued ${grabbed} episode grab(s) for ${series.title}`
          : response.result?.message || `No grabs started for ${series.title}`,
      );
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.error || error.message || "Request failed";
      alert(`Error: ${errorMsg}`);
    } finally {
      setRequestingSeries((prev) => {
        const next = new Set(prev);
        next.delete(seriesId);
        return next;
      });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "monitoring":
        return <Eye className="text-primary" size={16} />;
      case "downloading":
        return <Download className="text-warning" size={16} />;
      case "downloaded":
        return <CheckCircle2 className="text-success" size={16} />;
      case "error":
        return <AlertCircle className="text-danger" size={16} />;
      case "missing":
        return <Clock className="text-secondary" size={16} />;
      default:
        return <Clock size={16} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "monitoring":
        return "primary";
      case "downloading":
        return "warning";
      case "downloaded":
        return "success";
      case "error":
        return "danger";
      case "missing":
        return "secondary";
      default:
        return "default";
    }
  };

  const formatQuality = (quality: string) => {
    const qualityMap: { [key: string]: string } = {
      any: "Any",
      "hd-720p-1080p": "HD - 720p/1080p",
      "hd-720p": "HD-720p",
      "hd-1080p": "HD-1080p",
      sd: "SD",
      "ultra-hd": "Ultra-HD",
    };
    return qualityMap[quality] || quality;
  };

  const formatAvailability = (availability: string) => {
    const availabilityMap: { [key: string]: string } = {
      announced: "Announced",
      inCinemas: "In Cinemas",
      released: "Released",
    };
    return availabilityMap[availability] || availability;
  };

  // Combine movies and series for display
  const allItems: MonitoredItem[] = useMemo(() => {
    return [...movies, ...series];
  }, [movies, series]);

  // Filter items based on search and filters
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      // Search filter
      const matchesSearch =
        searchQuery.trim() === "" ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase());

      // Status filter
      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;

      // Quality filter
      const matchesQuality =
        qualityFilter === "all" || item.qualityProfile === qualityFilter;

      // Availability filter
      const matchesAvailability =
        availabilityFilter === "all" ||
        item.minAvailability === availabilityFilter;

      return (
        matchesSearch && matchesStatus && matchesQuality && matchesAvailability
      );
    });
  }, [allItems, searchQuery, statusFilter, qualityFilter, availabilityFilter]);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    statusFilter !== "all" ||
    qualityFilter !== "all" ||
    availabilityFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setQualityFilter("all");
    setAvailabilityFilter("all");
  };

  const handleMovieClick = async (movie: MonitoredMovie) => {
    setSelectedMovieForDownload(movie);
    setTorrents([]);
    // Initialize edit settings with current movie values
    setEditMonitor(movie.monitor || "movieOnly");
    setEditMinAvailability(movie.minAvailability || "released");
    setEditQualityProfile(movie.qualityProfile || "any");
    onDownloadModalOpen();

    // Search for torrents for this movie
    setLoadingTorrents(true);
    try {
      const token = localStorage.getItem("accessToken");
      const year = movie.releaseDate
        ? new Date(movie.releaseDate).getFullYear()
        : "";
      const response = await axios.get(
        `${API_BASE_URL}/api/TMDB/movie/${movie.tmdbId}/torrents`,
        {
          params: {
            title: movie.title,
            year: year,
          },
          headers: token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : undefined,
          timeout: 30000,
        },
      );

      if (response.data.success) {
        setTorrents(response.data.results || []);
      }
    } catch (error) {
      console.error("Error fetching torrents:", error);
      setTorrents([]);
    } finally {
      setLoadingTorrents(false);
    }
  };

  const handleUpdateSettings = async () => {
    if (!selectedMovieForDownload) return;

    setUpdatingSettings(true);
    try {
      await axios.put(
        `${API_BASE_URL}/api/MonitoredMovies/${selectedMovieForDownload.id}`,
        {
          monitor: editMonitor,
          minAvailability: editMinAvailability,
          qualityProfile: editQualityProfile,
        },
      );

      // Update local state
      setSelectedMovieForDownload({
        ...selectedMovieForDownload,
        monitor: editMonitor,
        minAvailability: editMinAvailability,
        qualityProfile: editQualityProfile,
      });

      // Refresh movies list
      await fetchMonitoredContent();

      alert("Settings updated successfully!");
    } catch (error) {
      console.error("Error updating settings:", error);
      alert("Failed to update settings");
    } finally {
      setUpdatingSettings(false);
    }
  };

  const handleDownloadTorrent = async (torrent: TorrentResult) => {
    if (!selectedMovieForDownload) return;

    setDownloading((prev) => new Set(prev).add(torrent.id));
    setDownloadError((prev) => {
      const next = new Map(prev);
      next.delete(torrent.id);
      return next;
    });

    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/DownloadClients/grab`,
        {
          downloadUrl: torrent.downloadUrl,
        },
      );

      if (response.data.success) {
        setDownloadSuccess((prev) => new Set(prev).add(torrent.id));

        // Update movie status to downloading
        await axios.put(
          `${API_BASE_URL}/api/MonitoredMovies/${selectedMovieForDownload.id}`,
          {
            status: "downloading",
            downloadedTorrentId: torrent.id,
            downloadedTorrentTitle: torrent.title,
          },
        );

        // Refresh movies list
        await fetchMonitoredContent();

        setTimeout(() => {
          setDownloadSuccess((prev) => {
            const next = new Set(prev);
            next.delete(torrent.id);
            return next;
          });
        }, 3000);
      } else {
        throw new Error(response.data.error || "Failed to queue release");
      }
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.error || error.message || "Action failed";
      setDownloadError((prev) => new Map(prev).set(torrent.id, errorMsg));
      setTimeout(() => {
        setDownloadError((prev) => {
          const next = new Map(prev);
          next.delete(torrent.id);
          return next;
        });
      }, 5000);
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev);
        next.delete(torrent.id);
        return next;
      });
    }
  };

  useEffect(() => {
    if (isDownloadModalOpen) {
      setOpenSelects(new Set());
    }
  }, [isDownloadModalOpen]);

  if (loadingAuth || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <YLogoLoader color="secondary" size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        actions={
          <>
              <Button
                color="success"
                variant="flat"
                className="flex-1 xs:flex-none"
                size="sm"
                startContent={<CheckCircle2 size={16} />}
                onPress={async () => {
                  if (!user) return;
                  try {
                    setLoading(true);
                    const checkParams = isAdmin
                      ? "scope=all"
                      : `userId=${encodeURIComponent(user.id)}`;
                    await axios.post(
                      `${API_BASE_URL}/api/MonitoredMovies/check-all?${checkParams}`,
                      undefined,
                      { headers: monitoredAuthHeaders() },
                    );
                    await fetchMonitoredContent();
                    alert("File check complete! Monitored list updated.");
                  } catch (error) {
                    console.error("Error checking files:", error);
                    alert("Failed to check files");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <span className="hidden xs:inline">Check All Files</span>
                <span className="xs:hidden">Check</span>
              </Button>
          <Button
                color="secondary"
                className="btn-glow flex-1 xs:flex-none"
            size="sm"
                startContent={<Film size={16} />}
                onPress={() => router.push("/pages/discover/movies")}
          >
                <span className="hidden xs:inline">Add titles</span>
                <span className="xs:hidden">Add</span>
          </Button>
          </>
        }
        description={
          isAdmin
            ? "All users' monitored movies and series (household view)"
            : "Manage your movies and series collection"
        }
        icon={<Film className="h-6 w-6" />}
        title="Monitored"
      />

      {/* Content */}
      <PageContent>
        {/* Search and Filters */}
        {allItems.length > 0 && (
          <Card className="mb-6 border border-secondary/20">
            <CardBody className="p-4 sm:p-6">
              <div className="space-y-4">
                {/* Search Bar */}
                <Input
                  classNames={{
                    inputWrapper: "bg-content2 border-2 border-secondary/20 hover:border-secondary/40 focus-within:border-secondary transition-all",
                  }}
                  endContent={
                    searchQuery && (
                      <Button
                        isIconOnly
                        variant="light"
                        size="sm"
                        onPress={() => setSearchQuery("")}
                      >
                        <X size={16} />
                      </Button>
                    )
                  }
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by title..."
                  size="md"
                  startContent={<Search size={18} className="text-secondary" />}
                  value={searchQuery}
                />

                {/* Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Select
                    classNames={{
                      trigger: "bg-content2 border border-secondary/20 hover:border-secondary/40",
                      label: "text-xs sm:text-sm",
                    }}
                    label="Status"
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys)[0] as string;
                      setStatusFilter(selected || "all");
                    }}
                    placeholder="All statuses"
                    selectedKeys={statusFilter === "all" ? [] : [statusFilter]}
                    size="sm"
                    startContent={<Filter size={16} className="text-secondary" />}
                  >
                    <SelectItem key="all">
                      All Statuses
                    </SelectItem>
                    <SelectItem key="monitoring">
                      Monitoring
                    </SelectItem>
                    <SelectItem key="downloading">
                      Downloading
                    </SelectItem>
                    <SelectItem key="downloaded">
                      Downloaded
                    </SelectItem>
                    <SelectItem key="error">
                      Error
                    </SelectItem>
                  </Select>

                  <Select
                    classNames={{
                      trigger: "bg-content2 border border-secondary/20 hover:border-secondary/40",
                      label: "text-xs sm:text-sm",
                    }}
                    label="Quality"
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys)[0] as string;
                      setQualityFilter(selected || "all");
                    }}
                    placeholder="All qualities"
                    selectedKeys={qualityFilter === "all" ? [] : [qualityFilter]}
                    size="sm"
                  >
                    <SelectItem key="all">
                      All Qualities
                    </SelectItem>
                    <SelectItem key="any">
                      Any
                    </SelectItem>
                    <SelectItem key="hd-720p-1080p">
                      HD - 720p/1080p
                    </SelectItem>
                    <SelectItem key="hd-720p">
                      HD-720p
                    </SelectItem>
                    <SelectItem key="hd-1080p">
                      HD-1080p
                    </SelectItem>
                    <SelectItem key="sd">
                      SD
                    </SelectItem>
                    <SelectItem key="ultra-hd">
                      Ultra-HD
                    </SelectItem>
                  </Select>

                  <Select
                    classNames={{
                      trigger: "bg-content2 border border-secondary/20 hover:border-secondary/40",
                      label: "text-xs sm:text-sm",
                    }}
                    label="Availability"
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys)[0] as string;
                      setAvailabilityFilter(selected || "all");
                    }}
                    placeholder="All availabilities"
                    selectedKeys={availabilityFilter === "all" ? [] : [availabilityFilter]}
                    size="sm"
                  >
                    <SelectItem key="all">
                      All Availabilities
                    </SelectItem>
                    <SelectItem key="announced">
                      Announced
                    </SelectItem>
                    <SelectItem key="inCinemas">
                      In Cinemas
                    </SelectItem>
                    <SelectItem key="released">
                      Released
                    </SelectItem>
                  </Select>
                </div>

                {/* Results count and clear filters */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-2 border-t border-secondary/10">
                  <p className="text-xs sm:text-sm text-foreground/60">
                    Showing {filteredItems.length} of {allItems.length} items (
                    {movies.length} movies, {series.length} series)
                    {hasActiveFilters && " (filtered)"}
                  </p>
                  {hasActiveFilters && (
                    <Button
                      className="text-xs sm:text-sm"
                      color="secondary"
                      onPress={clearFilters}
                      size="sm"
                      startContent={<X size={14} />}
                      variant="flat"
                    >
                      Clear Filters
                    </Button>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {allItems.length === 0 ? (
          <Card className="card-interactive">
            <CardBody className="text-center py-12 sm:py-16 px-4">
              <div className="flex flex-col items-center gap-4 max-w-md mx-auto">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-secondary/10 flex items-center justify-center">
                  <Film className="w-6 h-6 sm:w-8 sm:h-8 text-secondary" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-2">
                    Nothing monitored yet
                  </h3>
                  <p className="text-sm sm:text-base text-foreground/60 mb-4">
                    Start by searching for movies or series and adding them to
                    your monitored list.
                  </p>
                  <Button
                    className="btn-glow"
                    color="secondary"
                    onPress={() => router.push("/pages/discover/movies")}
                    size="sm"
                    startContent={<Film size={16} />}
                  >
                    Browse discover
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        ) : filteredItems.length === 0 ? (
          <Card className="card-interactive">
            <CardBody className="text-center py-12 sm:py-16 px-4">
              <div className="flex flex-col items-center gap-4 max-w-md mx-auto">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-secondary/10 flex items-center justify-center">
                  <Search className="w-6 h-6 sm:w-8 sm:h-8 text-secondary" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-2">
                    No Matches Found
                  </h3>
                  <p className="text-sm sm:text-base text-foreground/60 mb-4">
                    Try adjusting your search or filter criteria.
                  </p>
                  {hasActiveFilters && (
                    <Button
                      color="secondary"
                    onPress={clearFilters}
                      size="sm"
                    startContent={<X size={16} />}
                    variant="flat"
                    >
                      Clear Filters
                    </Button>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        ) : (
          <div className="grid gap-3 sm:gap-4 grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] md:grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]">
            {filteredItems.map((item) => {
              const isSeries = item.type === "series";
              const seriesItem = isSeries ? (item as MonitoredSeries) : null;
              const movieItem = !isSeries ? (item as MonitoredMovie) : null;

              const year = isSeries
                ? seriesItem?.firstAirDate
                  ? new Date(seriesItem.firstAirDate).getFullYear()
                  : null
                : movieItem?.releaseDate
                  ? new Date(movieItem.releaseDate).getFullYear()
                  : null;

              const statusLabel =
                item.status.charAt(0).toUpperCase() + item.status.slice(1);

              return (
                <div className="flex min-w-0 flex-col" key={item.id}>
                  {/* Image Section */}
                  <div
                    className="relative aspect-[2/3] w-full min-w-0 overflow-hidden rounded-lg cursor-pointer"
                    onClick={() => {
                      if (isSeries && seriesItem) {
                        // Handle series click - could open series modal or do nothing for now
                      } else if (movieItem) {
                        handleMovieClick(movieItem);
                      }
                    }}
                  >
                    {item.posterUrl ? (
                      <img
                        alt={item.title}
                        className="h-full w-full object-cover"
                        src={item.posterUrl}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-content2">
                        {isSeries ? (
                          <Tv className="text-foreground/40" size={32} />
                        ) : (
                          <Film className="text-foreground/40" size={32} />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      <Chip
                        className="h-6 max-w-full text-[10px] font-bold uppercase"
                        color={isSeries ? "secondary" : "primary"}
                        size="sm"
                        variant="flat"
                      >
                        {isSeries ? "TV" : "Movie"}
                      </Chip>
                      {movieItem?.fileExists && (
                        <Chip
                          className="h-6 max-w-full text-[10px]"
                          color="success"
                          size="sm"
                          startContent={<CheckCircle2 size={12} />}
                          title={`File found: ${movieItem.fileName || "Found in library"}`}
                          variant="flat"
                        >
                          On Disk
                        </Chip>
                      )}
                      <Chip
                        className="h-6 max-w-full text-[10px]"
                        color={getStatusColor(item.status)}
                        size="sm"
                        startContent={getStatusIcon(item.status)}
                        variant="flat"
                      >
                        {statusLabel}
                      </Chip>
                    </div>

                    <h3
                      className="cursor-pointer text-sm font-semibold leading-snug text-foreground line-clamp-2"
                      onClick={() => {
                        if (movieItem) {
                          handleMovieClick(movieItem);
                        }
                      }}
                      title={item.title}
                    >
                      {item.title}
                    </h3>
                    {year != null && (
                      <p className="text-xs text-foreground/60">{year}</p>
                    )}
                    {isAdmin && item.ownerUsername && (
                      <p
                        className="text-xs text-foreground/50 line-clamp-2"
                        title={`Requested by ${item.ownerUsername}`}
                      >
                        Requested by {item.ownerUsername}
                      </p>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-2 space-y-2">
                    {/* Request Button */}
                    <Button
                      className="w-full text-xs h-7 sm:h-8"
                      color="secondary"
                      isLoading={
                        isSeries 
                          ? requestingSeries.has(item.id)
                          : requesting.has(item.id)
                      }
                      onPress={() => {
                        if (isSeries && seriesItem) {
                          handleRequestSeries(seriesItem);
                        } else if (movieItem) {
                          handleRequestMovie(movieItem);
                        }
                      }}
                      size="sm"
                      startContent={<Search size={14} />}
                      variant="flat"
                    >
                      Request
                    </Button>

                    {/* Remove Button */}
                    <Button
                      className="w-full text-xs h-7 sm:h-8"
                      color="danger"
                      isLoading={
                        isSeries 
                          ? deletingSeries.has(item.id)
                          : deleting.has(item.id)
                      }
                      onPress={() => {
                        if (isSeries && seriesItem) {
                          handleRemoveSeries(seriesItem);
                        } else if (movieItem) {
                          handleRemoveMovie(movieItem);
                        }
                      }}
                      size="sm"
                      startContent={<Trash2 size={14} />}
                      variant="flat"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageContent>

      {/* Release search modal */}
      <Modal
        classNames={{
            backdrop: "bg-overlay/50 backdrop-blur-sm",
            base: "bg-content1 border border-secondary/20 mx-2 sm:mx-4 shadow-xl shadow-secondary/10",
          }}
          isDismissable={openSelects.size === 0}
          isOpen={isDownloadModalOpen}
          onClose={() => {
            if (openSelects.size === 0) {
              onDownloadModalClose();
              setSelectedMovieForDownload(null);
              setTorrents([]);
            }
          }}
          scrollBehavior="inside"
          shouldBlockScroll={true}
          size="5xl"
      >
        <ModalContent>
          <ModalHeader className="border-b border-secondary/20 bg-gradient-to-r from-secondary/5 to-transparent px-4 sm:px-6 py-4 sm:py-5">
            <div className="w-full">
              <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-secondary to-secondary-600 bg-clip-text text-transparent">
                {selectedMovieForDownload?.title}
              </h2>
              <p className="text-sm sm:text-base text-foreground/70 font-normal mt-1">
                {selectedMovieForDownload?.releaseDate &&
                  `Released: ${new Date(selectedMovieForDownload.releaseDate).getFullYear()}`}
              </p>
            </div>
          </ModalHeader>
          <ModalBody className="py-5 sm:py-6 px-4 sm:px-6">
            {selectedMovieForDownload && (
              <div className="space-y-5 sm:space-y-6">
                {/* Movie Info */}
                <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                  {selectedMovieForDownload.posterUrl && (
                    <div className="flex-shrink-0 mx-auto sm:mx-0">
                      <img
                        src={selectedMovieForDownload.posterUrl}
                        alt={selectedMovieForDownload.title}
                        className="w-24 sm:w-32 rounded-lg shadow-lg"
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm sm:text-base text-foreground/70 leading-relaxed">
                      {selectedMovieForDownload.overview ||
                        "No overview available"}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-4">
                      <Chip
                        size="sm"
                        variant="flat"
                        color="secondary"
                        className="text-xs"
                      >
                        {formatQuality(selectedMovieForDownload.qualityProfile)}
                      </Chip>
                      <Chip className="text-xs" size="sm" variant="flat">
                        {formatAvailability(
                          selectedMovieForDownload.minAvailability,
                        )}
                      </Chip>
                      <Chip
                        size="sm"
                        color={getStatusColor(selectedMovieForDownload.status)}
                        variant="flat"
                        startContent={getStatusIcon(
                          selectedMovieForDownload.status,
                        )}
                        className="text-xs"
                      >
                        {selectedMovieForDownload.status
                          .charAt(0)
                          .toUpperCase() +
                          selectedMovieForDownload.status.slice(1)}
                      </Chip>
                    </div>
                  </div>
                </div>

                {/* Editable Settings */}
                <Card className="bg-content2 border border-secondary/20">
                  <CardBody className="p-4 sm:p-6">
                    <div className="space-y-4">
                      <h3 className="text-base sm:text-lg font-semibold text-foreground">
                        Edit Settings
                      </h3>
                      <div
                        className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <Select
                          classNames={{
                              trigger: "bg-content1 border border-secondary/20 hover:border-secondary/40",
                              label: "text-xs sm:text-sm",
                            }}
                            disallowEmptySelection
                            label="Monitor"
                            labelPlacement="outside"
                            onOpenChange={(open) => {
                              setOpenSelects((prev) => {
                                const next = new Set(prev);
                                if (open) {
                                  next.add("editMonitor");
                                } else {
                                  next.delete("editMonitor");
                                }
                                return next;
                              });
                            }}
                            onSelectionChange={(keys) => {
                              const keysArray = Array.from(keys);
                              if (keysArray.length > 0) {
                                const selected = keysArray[0] as string;
                                setEditMonitor(selected);
                              }
                            }}
                            placeholder="Select monitor option"
                            selectedKeys={editMonitor ? new Set([editMonitor]) : new Set()}
                            size="sm"
                        >
                          <SelectItem key="movieOnly">
                            Movie Only
                          </SelectItem>
                        </Select>

                        <Select
                          classNames={{
                              trigger: "bg-content1 border border-secondary/20 hover:border-secondary/40",
                              label: "text-xs sm:text-sm",
                            }}
                            disallowEmptySelection
                            label="Minimum Availability"
                            labelPlacement="outside"
                            onOpenChange={(open) => {
                              setOpenSelects((prev) => {
                                const next = new Set(prev);
                                if (open) {
                                  next.add("editAvailability");
                                } else {
                                  next.delete("editAvailability");
                                }
                                return next;
                              });
                            }}
                            onSelectionChange={(keys) => {
                              const keysArray = Array.from(keys);
                              if (keysArray.length > 0) {
                                const selected = keysArray[0] as string;
                                setEditMinAvailability(selected);
                              }
                            }}
                            placeholder="Select availability"
                            selectedKeys={editMinAvailability ? new Set([editMinAvailability]) : new Set()}
                            size="sm"
                        >
                          <SelectItem key="announced">
                            Announced
                          </SelectItem>
                          <SelectItem key="inCinemas">
                            In Cinemas
                          </SelectItem>
                          <SelectItem key="released">
                            Released
                          </SelectItem>
                        </Select>

                        <Select
                          label="Quality Profile"
                          labelPlacement="outside"
                          placeholder="Select quality"
                          selectedKeys={
                            editQualityProfile
                              ? new Set([editQualityProfile])
                              : new Set()
                          }
                          onSelectionChange={(keys) => {
                            const keysArray = Array.from(keys);
                            if (keysArray.length > 0) {
                              const selected = keysArray[0] as string;
                              setEditQualityProfile(selected);
                            }
                          }}
                          onOpenChange={(open) => {
                            setOpenSelects((prev) => {
                              const next = new Set(prev);
                              if (open) {
                                next.add("editQuality");
                              } else {
                                next.delete("editQuality");
                              }
                              return next;
                            });
                          }}
                          size="sm"
                          classNames={{
                            trigger:
                              "bg-content1 border border-secondary/20 hover:border-secondary/40",
                            label: "text-xs sm:text-sm",
                          }}
                          disallowEmptySelection
                        >
                          <SelectItem key="any">
                            Any
                          </SelectItem>
                          <SelectItem key="hd-720p-1080p">
                            HD - 720p/1080p
                          </SelectItem>
                          <SelectItem key="hd-720p">
                            HD-720p
                          </SelectItem>
                          <SelectItem key="hd-1080p">
                            HD-1080p
                          </SelectItem>
                          <SelectItem key="sd">
                            SD
                          </SelectItem>
                          <SelectItem key="ultra-hd">
                            Ultra-HD
                          </SelectItem>
                        </Select>
                      </div>
                      <Button
                        color="secondary"
                        className="btn-glow w-full sm:w-auto text-xs sm:text-sm"
                        onPress={handleUpdateSettings}
                        isLoading={updatingSettings}
                        size="sm"
                      >
                        Update Settings
                      </Button>
                    </div>
                  </CardBody>
                </Card>

                {/* Releases section */}
                <div>
                  <h3 className="text-base sm:text-lg font-semibold mb-4 text-foreground">
                    Available Releases
                  </h3>

                  {loadingTorrents ? (
                    <div className="flex justify-center items-center py-8">
                      <YLogoLoader color="secondary" />
                      <p className="ml-3 text-sm text-foreground/60">
                        Searching indexers...
                      </p>
                    </div>
                  ) : torrents.length > 0 ? (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                      {torrents.map((torrent) => (
                        <Card
                          key={torrent.id}
                          className="hover-lift border border-secondary/10 hover:border-secondary/30 transition-all"
                        >
                          <CardBody className="p-3 sm:p-4">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm sm:text-base truncate mb-1">
                                  {torrent.title}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-foreground/60">
                                  <Chip
                                    size="sm"
                                    variant="flat"
                                    color="secondary"
                                    className="text-[10px] sm:text-xs h-5"
                                  >
                                    {torrent.indexer}
                                  </Chip>
                                  <span>{torrent.sizeFormatted}</span>
                                  <span className="flex items-center gap-1">
                                    <span>👤</span> {torrent.seeders || 0}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <span>⬇️</span> {torrent.leechers || 0}
                                  </span>
                                </div>
                              </div>
                              <Button
                                className={downloadSuccess.has(torrent.id) ? "text-xs sm:text-sm flex-shrink-0" : "btn-glow text-xs sm:text-sm flex-shrink-0"}
                                  color={downloadSuccess.has(torrent.id) ? "success" : downloadError.has(torrent.id) ? "danger" : "secondary"}
                                  isDisabled={downloading.has(torrent.id) || !torrent.downloadUrl}
                                  isLoading={downloading.has(torrent.id)}
                                  onPress={() => handleDownloadTorrent(torrent)}
                                  size="sm"
                                  startContent={
                                    downloadSuccess.has(torrent.id) ? (
                                      <Check size={16} />
                                    ) : (
                                      <Download size={16} />
                                    )
                                  }
                              >
                                {downloadSuccess.has(torrent.id)
                                  ? "Queued"
                                  : "Grab"}
                              </Button>
                            </div>
                            {downloadError.has(torrent.id) && (
                              <div className="mt-2 p-2 bg-danger/10 border border-danger/20 rounded-lg">
                                <p className="text-xs text-danger">
                                  {downloadError.get(torrent.id)}
                                </p>
                              </div>
                            )}
                          </CardBody>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <Card className="bg-content2 border border-secondary/20">
                      <CardBody className="text-center py-8">
                        <div className="flex flex-col items-center gap-2">
                          <Search className="w-8 h-8 text-foreground/40" />
                          <p className="text-sm text-foreground/60">
                            No releases found for this movie
                          </p>
                        </div>
                      </CardBody>
                    </Card>
                  )}
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter className="border-t border-secondary/20 px-4 sm:px-6 py-3 sm:py-4">
            <Button
              variant="flat"
              onPress={onDownloadModalClose}
              size="sm"
              className="text-xs sm:text-sm"
            >
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ScrollToTop />
    </div>
  );
};

export default Monitored;
