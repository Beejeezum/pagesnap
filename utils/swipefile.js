/**
 * PageSnap - Swipe File (Inspiration Library)
 * Local storage-based content library with tagging and search.
 */

const PageSnapSwipeFile = {
  STORAGE_KEY: 'pagesnap_swipefile',
  MAX_ITEMS: 200,

  /**
   * Save content to the swipe file
   */
  async save(item) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      url: item.url || '',
      domain: item.domain || '',
      title: item.title || '',
      excerpt: item.excerpt || '',
      content: (item.content?.text || '').substring(0, 2000),
      author: item.author || '',
      ogImage: item.ogImage || '',
      thumbnail: item.thumbnail || '',
      tags: item.tags || [],
      userTags: item.userTags || [],
      notes: item.notes || '',
      outputs: item.outputs || [], // Generated content (quotes, posts, etc.)
      screenshot: item.screenshot || '', // Small thumbnail, not full image
      favorite: false
    };

    const items = await this._getAll();
    items.unshift(entry);

    // Cap at max items
    if (items.length > this.MAX_ITEMS) {
      items.length = this.MAX_ITEMS;
    }

    await chrome.storage.local.set({ [this.STORAGE_KEY]: items });
    return entry;
  },

  /**
   * Get all swipe file items
   */
  async getAll() {
    return await this._getAll();
  },

  /**
   * Get a single item by ID
   */
  async getById(id) {
    const items = await this._getAll();
    return items.find(i => i.id === id) || null;
  },

  /**
   * Update an existing item
   */
  async update(id, changes) {
    const items = await this._getAll();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return null;

    items[idx] = { ...items[idx], ...changes };
    await chrome.storage.local.set({ [this.STORAGE_KEY]: items });
    return items[idx];
  },

  /**
   * Toggle favorite
   */
  async toggleFavorite(id) {
    const items = await this._getAll();
    const item = items.find(i => i.id === id);
    if (!item) return null;
    item.favorite = !item.favorite;
    await chrome.storage.local.set({ [this.STORAGE_KEY]: items });
    return item;
  },

  /**
   * Add a generated output to an item
   */
  async addOutput(id, output) {
    const items = await this._getAll();
    const item = items.find(i => i.id === id);
    if (!item) return null;
    if (!item.outputs) item.outputs = [];
    item.outputs.push({
      ...output,
      generatedAt: new Date().toISOString()
    });
    await chrome.storage.local.set({ [this.STORAGE_KEY]: items });
    return item;
  },

  /**
   * Delete an item
   */
  async remove(id) {
    const items = await this._getAll();
    const filtered = items.filter(i => i.id !== id);
    await chrome.storage.local.set({ [this.STORAGE_KEY]: filtered });
    return true;
  },

  /**
   * Search items by text query
   */
  async search(query) {
    const items = await this._getAll();
    const q = query.toLowerCase();
    return items.filter(item => {
      return (item.title && item.title.toLowerCase().includes(q)) ||
             (item.excerpt && item.excerpt.toLowerCase().includes(q)) ||
             (item.content && item.content.toLowerCase().includes(q)) ||
             (item.url && item.url.toLowerCase().includes(q)) ||
             (item.tags && item.tags.some(t => t.toLowerCase().includes(q))) ||
             (item.userTags && item.userTags.some(t => t.toLowerCase().includes(q))) ||
             (item.notes && item.notes.toLowerCase().includes(q));
    });
  },

  /**
   * Filter by tag
   */
  async filterByTag(tag) {
    const items = await this._getAll();
    const t = tag.toLowerCase();
    return items.filter(item => {
      const allTags = [...(item.tags || []), ...(item.userTags || [])];
      return allTags.some(tg => tg.toLowerCase() === t);
    });
  },

  /**
   * Get all unique tags
   */
  async getAllTags() {
    const items = await this._getAll();
    const tagSet = new Set();
    items.forEach(item => {
      (item.tags || []).forEach(t => tagSet.add(t));
      (item.userTags || []).forEach(t => tagSet.add(t));
    });
    return Array.from(tagSet).sort();
  },

  /**
   * Get favorites only
   */
  async getFavorites() {
    const items = await this._getAll();
    return items.filter(i => i.favorite);
  },

  /**
   * Clear entire swipe file
   */
  async clear() {
    await chrome.storage.local.remove(this.STORAGE_KEY);
    return true;
  },

  /**
   * Export swipe file as JSON
   */
  async exportJSON() {
    const items = await this._getAll();
    return JSON.stringify(items, null, 2);
  },

  // --- Private ---
  async _getAll() {
    const result = await chrome.storage.local.get(this.STORAGE_KEY);
    return result[this.STORAGE_KEY] || [];
  }
};
