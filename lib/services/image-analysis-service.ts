export interface PredictionResponse {
  filename: string;
  predicted_class: string;
  confidence_score: string;
  quality_score: number;
  message: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 35000; // slightly above the server-side 30s limit

// Sends the image to our own authenticated API route; the ML service URL never reaches the browser.
export const analyzeCropImage = async (file: File): Promise<PredictionResponse | null> => {
  // Validate input
  if (!file || !(file instanceof File)) {
    console.error("Invalid file provided for analysis");
    return null;
  }
  if (!file.type.startsWith('image/')) {
    throw new Error("Only image files can be analyzed");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image must be 5 MB or smaller");
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch('/api/quality-analysis', {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const serverMessage = body && typeof body.error === 'string' ? body.error : null;

      if (response.status === 503) {
        // Not configured: callers treat null as "analysis unavailable".
        return null;
      }
      if (response.status === 401) {
        throw new Error("Please sign in again to analyze images");
      }
      if (response.status === 429) {
        throw new Error("Too many analysis requests - please wait a few minutes and try again");
      }
      throw new Error(serverMessage || "Quality analysis is temporarily unavailable");
    }

    const data = await response.json();

    // Validate response data
    if (!data || typeof data !== 'object') {
      throw new Error("Invalid response format from analysis service");
    }

    // Ensure all required fields exist with fallbacks
    const validatedData: PredictionResponse = {
      filename: file.name || 'unknown',
      predicted_class: data.predicted_class || 'unknown',
      confidence_score: data.confidence_score || '0%',
      quality_score: typeof data.quality_score === 'number' ? data.quality_score : 0,
      message: data.message || 'Analysis completed'
    };

    return validatedData;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error("Analysis timed out - the service may be slow or unavailable");
      } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error("Unable to connect to the analysis service - please check your internet connection");
      }
      throw error;
    }
    throw new Error("An unexpected error occurred during analysis");
  }
};

// Helper function to convert image URL to File object
export const urlToFile = async (url: string, filename: string): Promise<File | null> => {
  // Validate inputs
  if (!url || typeof url !== 'string' || !filename || typeof filename !== 'string') {
    console.error("Invalid URL or filename provided");
    return null;
  }

  // Skip placeholder URLs
  if (url.includes('/api/placeholder/') || url.includes('placeholder')) {
    return null;
  }

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    
    // Validate that we got a valid image blob
    if (!blob || blob.size === 0) {
      throw new Error("Empty or invalid image data");
    }

    // Check if it's actually an image
    if (!blob.type.startsWith('image/')) {
      throw new Error("File is not a valid image");
    }

    return new File([blob], filename, { type: blob.type });
  } catch (error) {
    console.error("Error converting URL to file:", error);
    return null;
  }
};

// Helper function to format class name for display
export const formatClassName = (className: string | undefined | null): string => {
  if (!className || typeof className !== 'string') {
    return 'Unknown';
  }
  
  try {
    return className
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  } catch (error) {
    return 'Unknown';
  }
};

// Helper function to get quality color based on score
export const getQualityColor = (score: number | undefined | null): string => {
  if (typeof score !== 'number' || isNaN(score)) {
    return 'text-gray-600 bg-gray-50 border-gray-200';
  }
  
  if (score >= 4) return 'text-green-600 bg-green-50 border-green-200';
  if (score >= 3) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  return 'text-red-600 bg-red-50 border-red-200';
};

// Helper function to get confidence color based on percentage
export const getConfidenceColor = (confidence: string | undefined | null): string => {
  if (!confidence || typeof confidence !== 'string') {
    return 'text-gray-600';
  }
  
  try {
    const percentage = parseFloat(confidence.replace('%', ''));
    if (isNaN(percentage)) return 'text-gray-600';
    
    if (percentage >= 80) return 'text-green-600';
    if (percentage >= 60) return 'text-yellow-600';
    return 'text-red-600';
  } catch (error) {
    return 'text-gray-600';
  }
};