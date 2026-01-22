/**
 * Rally WSAPI REST Client
 *
 * Thin wrapper around native fetch for Rally Web Services API v2.0.
 * Provides typed methods for query, create, and update operations.
 */

export interface RallyQueryConfig {
  type: string;
  fetch?: string[];
  query?: string;
  limit?: number;
  workspace?: string;
  project?: string;
  projectScopeDown?: boolean;
  order?: string;
}

export interface RallyQueryResult {
  QueryResult: {
    Results: any[];
    TotalResultCount: number;
    Errors: string[];
    Warnings: string[];
  };
}

export interface RallyCreateConfig {
  type: string;
  data: any;
  fetch?: string[];
}

export interface RallyCreateResult {
  CreateResult: {
    Object: any;
    Errors: string[];
    Warnings: string[];
  };
}

export interface RallyUpdateConfig {
  type: string;
  ref: string;
  data: any;
  fetch?: string[];
}

export interface RallyUpdateResult {
  OperationResult: {
    Object: any;
    Errors: string[];
    Warnings: string[];
  };
}

export interface RallyApiConfig {
  apiKey: string;
  server?: string;
  requestOptions?: {
    headers?: Record<string, string>;
  };
}

export class RallyRestApi {
  private apiKey: string;
  public server: string;
  private customHeaders: Record<string, string>;

  constructor(config: RallyApiConfig) {
    this.apiKey = config.apiKey;
    this.server = config.server || 'https://rally1.rallydev.com';
    this.customHeaders = config.requestOptions?.headers || {};
  }

  /**
   * Query Rally artifacts
   */
  async query(config: RallyQueryConfig): Promise<RallyQueryResult> {
    const params = new URLSearchParams();

    if (config.query) {
      params.set('query', config.query);
    }

    if (config.fetch && config.fetch.length > 0) {
      params.set('fetch', config.fetch.join(','));
    }

    if (config.limit !== undefined) {
      params.set('pagesize', String(config.limit));
    }

    if (config.workspace) {
      params.set('workspace', config.workspace);
    }

    if (config.project) {
      params.set('project', config.project);
      if (config.projectScopeDown) {
        params.set('projectScopeDown', 'true');
      }
    }

    if (config.order) {
      params.set('order', config.order);
    }

    const url = `${this.server}/slm/webservice/v2.0/${config.type}?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'ZSESSIONID': this.apiKey,
        'Content-Type': 'application/json',
        ...this.customHeaders,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Unauthorized: Invalid API key or insufficient permissions');
      }
      throw new Error(`Rally API query failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as RallyQueryResult;

    if (result.QueryResult.Errors && result.QueryResult.Errors.length > 0) {
      throw new Error(`Rally API query failed: ${result.QueryResult.Errors.join(', ')}`);
    }

    return result;
  }

  /**
   * Create a Rally object
   */
  async create(config: RallyCreateConfig): Promise<RallyCreateResult> {
    const url = `${this.server}/slm/webservice/v2.0/${config.type}/create`;

    const body: any = {
      [config.type]: config.data,
    };

    const params = new URLSearchParams();
    if (config.fetch && config.fetch.length > 0) {
      params.set('fetch', config.fetch.join(','));
    }

    const finalUrl = params.toString() ? `${url}?${params.toString()}` : url;

    const response = await fetch(finalUrl, {
      method: 'POST',
      headers: {
        'ZSESSIONID': this.apiKey,
        'Content-Type': 'application/json',
        ...this.customHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Rally API create failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as RallyCreateResult;

    if (result.CreateResult.Errors && result.CreateResult.Errors.length > 0) {
      throw new Error(`Rally API create failed: ${result.CreateResult.Errors.join(', ')}`);
    }

    return result;
  }

  /**
   * Update a Rally object
   */
  async update(config: RallyUpdateConfig): Promise<RallyUpdateResult> {
    // Extract ObjectID from ref (e.g., "/hierarchicalrequirement/12345" -> "12345")
    const objectId = config.ref.split('/').pop();
    const url = `${this.server}/slm/webservice/v2.0/${config.type}/${objectId}`;

    const body: any = {
      [config.type]: config.data,
    };

    const params = new URLSearchParams();
    if (config.fetch && config.fetch.length > 0) {
      params.set('fetch', config.fetch.join(','));
    }

    const finalUrl = params.toString() ? `${url}?${params.toString()}` : url;

    const response = await fetch(finalUrl, {
      method: 'POST',
      headers: {
        'ZSESSIONID': this.apiKey,
        'Content-Type': 'application/json',
        ...this.customHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Rally API update failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as RallyUpdateResult;

    if (result.OperationResult.Errors && result.OperationResult.Errors.length > 0) {
      throw new Error(`Rally API update failed: ${result.OperationResult.Errors.join(', ')}`);
    }

    return result;
  }
}
