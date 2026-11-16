/**
 * TMDB Routes
 * API routes for TMDB movie search and details
 */

const express = require('express');
const router = express.Router();
const TMDBController = require('../controllers/TMDB');
const { authenticateToken } = require('../middleware/auth');
const {
  tmdbGeneralLimiter,
  tmdbSearchLimiter,
  tmdbResponseCache,
} = require('../middleware/tmdb');

router.use(authenticateToken);
router.use(tmdbGeneralLimiter);
router.use(tmdbResponseCache);

router.get('/search', tmdbSearchLimiter, TMDBController.searchMovies);

router.get('/popular/movies', TMDBController.getPopularMovies);
router.get('/popular/tv', TMDBController.getPopularTVShows);

router.get('/trending/movies', TMDBController.getTrendingMovies);
router.get('/trending/tv', TMDBController.getTrendingTVShows);

router.get('/top-rated/movies', TMDBController.getTopRatedMovies);
router.get('/top-rated/tv', TMDBController.getTopRatedTVShows);

router.get('/upcoming/movies', TMDBController.getUpcomingMovies);
router.get('/upcoming/tv', TMDBController.getUpcomingTVShows);

router.get('/genre/movies', TMDBController.getMoviesByGenre);
router.get('/genre/tv', TMDBController.getTVShowsByGenre);

router.get('/discover/movies', TMDBController.discoverMovies);
router.get('/discover/tv', TMDBController.discoverTVShows);

router.get('/genres', TMDBController.getGenres);

router.get('/watch/providers', TMDBController.getWatchProviders);

router.get('/popular/tv/providers', TMDBController.getPopularTVShowsWithProviders);
router.get('/popular/movies/providers', TMDBController.getPopularMoviesWithProviders);

router.get('/movie/:id', TMDBController.getMovieDetails);
router.get('/tv/:id', TMDBController.getTVShowDetails);

router.get('/company/:id', TMDBController.getCompanyDetails);
router.get('/network/:id', TMDBController.getNetworkDetails);

router.get('/tv/:id/season/:seasonNumber', TMDBController.getTVSeasonDetails);

router.get('/person/:id/movies', TMDBController.getMoviesByPerson);
router.get('/person/:id/tv', TMDBController.getTVShowsByPerson);

router.get('/movie/:id/torrents', TMDBController.searchTorrentsForMovie);
router.get('/tv/:id/torrents', TMDBController.searchTorrentsForTVEpisode);

module.exports = router;