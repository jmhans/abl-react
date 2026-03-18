// API client for communicating with Next.js API routes

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

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
    return this.request(`/teams/${id}`);
  }

  async createTeam(data: any) {
    return this.request('/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTeam(id: string, data: any) {
    return this.request(`/teams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTeam(id: string) {
    return this.request(`/teams/${id}`, {
      method: 'DELETE',
    });
  }

  // Owners
  async getOwners() {
    return this.request('/owners');
  }

  async getOwner(id: string) {
    return this.request(`/owners/${id}`);
  }

  async createOwner(data: any) {
    return this.request('/owners', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateOwner(id: string, data: any) {
    return this.request(`/owners/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteOwner(id: string) {
    return this.request(`/owners/${id}`, {
      method: 'DELETE',
    });
  }

  // Players
  async getPlayers() {
    return this.request('/players');
  }

  async getPlayer(id: string) {
    return this.request(`/players/${id}`);
  }

  async createPlayer(data: any) {
    return this.request('/players', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePlayer(id: string, data: any) {
    return this.request(`/players/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deletePlayer(id: string) {
    return this.request(`/players/${id}`, {
      method: 'DELETE',
    });
  }

  // Games - To be implemented
  async getGames(date?: string) {
    const query = date ? `?date=${date}` : '';
    return this.request(`/games${query}`);
  }

  async getGame(id: string) {
    return this.request(`/games/${id}`);
  }

  // Rosters - To be implemented
  async getRoster(teamId: string) {
    return this.request(`/rosters/${teamId}`);
  }

  // Standings - To be implemented
  async getStandings() {
    return this.request('/standings');
  }
}

export const api = new ApiClient();
