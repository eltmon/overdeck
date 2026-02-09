/**
 * Mock Rally WSAPI Server for Testing
 *
 * Simulates Rally WSAPI v2.0 behavior including query syntax validation.
 * Validates that queries have proper parentheses nesting as required by Rally.
 */

export interface MockRallyArtifact {
  ObjectID: string;
  FormattedID: string;
  Name: string;
  Description?: string;
  ScheduleState?: string;
  State?: string;
  Tags?: { _tagsNameArray: string[] };
  Owner?: { _refObjectName: string } | null;
  Priority?: string;
  DueDate?: string | null;
  CreationDate: string;
  LastUpdateDate: string;
  Parent?: any;
  _type: string;
  _ref?: string;
}

export class RallyApiMock {
  private testData: MockRallyArtifact[] = [];
  private _lastQuery: string = '';
  private forceParseError: string | null = null;
  private forceAuthError: boolean = false;

  get lastQuery(): string {
    return this._lastQuery;
  }

  addTestData(artifacts: MockRallyArtifact[]): void {
    this.testData.push(...artifacts);
  }

  clearTestData(): void {
    this.testData = [];
  }

  setParseError(message: string): void {
    this.forceParseError = message;
  }

  setAuthError(enabled: boolean): void {
    this.forceAuthError = enabled;
  }

  clearErrors(): void {
    this.forceParseError = null;
    this.forceAuthError = false;
  }

  /**
   * Simulate a Rally WSAPI query.
   * Validates query syntax (parentheses matching) like the real Rally parser.
   */
  async query(config: {
    type?: string;
    query?: string;
    fetch?: string[];
    limit?: number;
    workspace?: string;
    project?: string;
  }): Promise<{
    QueryResult: {
      Results: MockRallyArtifact[];
      TotalResultCount: number;
      Errors: string[];
      Warnings: string[];
    };
  }> {
    this._lastQuery = config.query || '';

    if (this.forceAuthError) {
      throw new Error('Unauthorized: Invalid API key or insufficient permissions');
    }

    if (this.forceParseError) {
      return {
        QueryResult: {
          Results: [],
          TotalResultCount: 0,
          Errors: [`Could not parse: Error parsing expression -- ${this.forceParseError}`],
          Warnings: [],
        },
      };
    }

    // Validate query syntax
    if (config.query) {
      const validationError = this.validateQuerySyntax(config.query);
      if (validationError) {
        return {
          QueryResult: {
            Results: [],
            TotalResultCount: 0,
            Errors: [validationError],
            Warnings: [],
          },
        };
      }
    }

    const limit = config.limit ?? 50;
    const results = this.testData.slice(0, limit);

    return {
      QueryResult: {
        Results: results,
        TotalResultCount: this.testData.length,
        Errors: [],
        Warnings: [],
      },
    };
  }

  /**
   * Validate Rally WSAPI query syntax.
   * Rally requires balanced parentheses and outer wrapping for compound expressions.
   */
  private validateQuerySyntax(query: string): string | null {
    // Check balanced parentheses
    let depth = 0;
    for (const char of query) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (depth < 0) {
        return 'Could not parse: Error parsing expression -- unexpected ")" found';
      }
    }
    if (depth !== 0) {
      return `Could not parse: Error parsing expression -- expected ")" but reached end of expression`;
    }

    // Check that compound expressions (containing AND/OR at top level) have outer wrapping parens.
    // Strip outer parens and check if the remaining content has unbalanced AND/OR at depth 0.
    if (query.includes(' AND ') || query.includes(' OR ')) {
      const trimmed = query.trim();
      if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
        return 'Could not parse: Error parsing expression -- expected "(" at start of expression';
      }

      // Check if the outer parens actually wrap the entire expression
      // by verifying that removing them leaves a balanced expression
      const inner = trimmed.slice(1, -1);
      let innerDepth = 0;
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '(') innerDepth++;
        if (inner[i] === ')') innerDepth--;
        if (innerDepth < 0) {
          // The outer parens don't wrap the whole expression
          return 'Could not parse: Error parsing expression -- expected ")" but saw "AND" instead.';
        }
      }
    }

    return null;
  }
}
