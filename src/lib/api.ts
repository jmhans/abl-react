// API client for communicating with Express backend

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api3';

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: RequestInit = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  // Teams
  async getTeams() {
    return this.request('/teams');
  }

  async getTeam(id: string) {
    return this.request(`/team/${id}`);
  }

  // Games - Note: games endpoint may not exist in api3, check backend
  async getGames(date?: string) {
    const query = date ? `?date=${date}` : '';
    return this.request(`/games${query}`);
  }

  async getGame(id: string) {
    return this.request(`/games/${id}`);
  }

  // Rosters
  async getRoster(teamId: string) {
    return this.request(`/rosters/${teamId}`);
  }

  // Owners
  async getOwners() {
    return this.request('/owners');
  }

  async getOwner(id: string) {
    return this.request(`/owner/${id}`);
  }

  // Standings - may need to use /league
  async getStandings() {
    return this.request('/league');
  }

  // MLB Players
  async getMlbPlayers() {
    return this.request('/mlbPlayers');
  }
}

export const api = new ApiClient();
