# Validation Requirements for Monitoring and Release Actions

## Overview
Users must meet three requirements before they can add titles to monitoring, search indexers, or queue releases to a download client:

### 1. User Authentication
- Users must be signed in to the application
- If not signed in, they will see: "Sign In Required - Please sign in to add titles to your library. Click on 'Login' in the navigation menu to get started."

### 2. Indexers Configuration
- Users must have at least one active indexer configured
- Indexers are external Torznab/Newznab (or compatible) sources you configure yourself
- If no indexers are configured, users will see: "Indexers Required - You need to configure at least one indexer before queuing releases. Go to Settings → Indexers to add an indexer."

### 3. Download Client Configuration
- Users must have at least one active download client configured
- Download clients receive grab requests from BorrowArr; BorrowArr does not download on its own
- If no download clients are configured, users will see: "Download Client Required - You need to configure a download client before queuing releases. Go to Settings → Download Clients to add a client."

## Implementation Details

### Modified Components
1. **AddMovieModal.tsx**
   - Added `checkRequirements()` function to verify indexers and download clients
   - Added `validateBeforeAction()` function to check all requirements before any grab/monitor action
   - Integrated validation into:
     - `handleDownloadTorrent()` - Manual release selection
     - `handleAddMovie()` - Movie monitoring and automatic search on add

2. **AddSeriesModal.tsx**
   - Added `checkRequirements()` function to verify indexers and download clients
   - Added `validateBeforeAction()` function to check all requirements before any grab/monitor action
   - Integrated validation into:
     - `handleDownloadTorrent()` - Manual release selection for episodes/seasons
     - `downloadEpisode()` - Individual episode grabs
     - `handleAddSeries()` - Series monitoring and bulk search on add

### User Experience Flow
1. User clicks add/monitor/grab control
2. System validates:
   - Is user signed in?
   - Does user have active indexers?
   - Does user have active download clients?
3. If any requirement fails, show helpful notification with next steps
4. If all requirements pass, proceed with the action

### Benefits
- **Security**: Ensures only authenticated users can queue releases
- **Configuration Safety**: Prevents actions without proper setup
- **User Guidance**: Clear messages guide users to complete necessary setup steps
- **Better UX**: Reduces confusing errors from missing configuration

## Testing
To test the validation:
1. Try adding/monitoring while signed out → should show sign-in message
2. Sign in without indexers → should show indexers required message
3. Add indexers but no download client → should show download client required message
4. Add all requirements → should allow actions successfully