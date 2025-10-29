export interface PromptItem {
  id: string;
  title: string;
  description: string;
  body: string;
  tags: string[];
}

export interface PromptCategory {
  id: string;
  label: string;
  description: string;
  items: PromptItem[];
}

export interface PromptDictionary {
  version: number;
  metadata: {
    description: string;
    updatedAt: string;
  };
  categories: PromptCategory[];
}

