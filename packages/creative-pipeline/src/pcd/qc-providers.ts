// MERGE-BACK: replace with Switchboard QC provider contracts at merge-back time.
// SP5 ships only the contract surface; concrete production implementations
// land in Switchboard's QC service. In-tree consumers (predicates, tests)
// inject test stubs that conform to these types.

export type SimilarityProvider = {
  scoreFaceSimilarity(input: {
    creatorReferenceAssetIds: string[];
    candidateAssetId: string;
  }): Promise<{ score: number }>;
  scoreLogoSimilarity(input: {
    productLogoAssetId: string;
    candidateAssetId: string;
  }): Promise<{ score: number }>;
};

export type OcrProvider = {
  extractText(input: { candidateAssetId: string }): Promise<{ text: string }>;
};

export type GeometryProvider = {
  measure(input: {
    candidateAssetId: string;
    productDimensionsMm?: { h: number; w: number; d: number } | null;
    shotType: string;
  }): Promise<{ score: number; scaleConfidence: number }>;
};

export type PcdQcProviders = {
  similarityProvider: SimilarityProvider;
  ocrProvider: OcrProvider;
  geometryProvider: GeometryProvider;
};
