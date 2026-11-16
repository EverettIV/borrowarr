import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

export type SetupStatus = {
  enabled: boolean;
  isFirstRun: boolean;
};

const SETUP_STATUS_URL = `${API_BASE_URL}/api/Settings/public-registration-status`;

export async function fetchSetupStatus(
  maxAttempts = 10,
  delayMs = 400,
): Promise<SetupStatus> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await axios.get(SETUP_STATUS_URL);
      return {
        enabled: Boolean(response.data?.enabled),
        isFirstRun: Boolean(response.data?.isFirstRun),
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}