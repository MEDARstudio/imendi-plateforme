// Supabase configuration
const SUPABASE_URL = 'https://cxjftikjoskdeakoxhgr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4amZ0aWtqb3NrZGVha294aGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MDA1OTgsImV4cCI6MjA3NTA3NjU5OH0.CS2iXOABcX4QPY472eXW8MkxoQJXDiC_WzKWPhFtISY';

class IMENDITransApp {
    constructor() {
        this.currentUser = null;
        this.currentView = 'dashboard';
        this.offlineMode = !navigator.onLine;
        this.db = null;
        this.lastGeneratedNumber = 0; // Tracks the highest sequential number in the current session.
        this.pendingBonData = null; // For confirmation modal
        
        this.init();
    }

    async init() {
        this.initTheme();
        this.lastGeneratedNumber = parseInt(localStorage.getItem('lastGeneratedNumber') || '0', 10);
        this.showLoader();
        await this.initDatabase();
        this.setupEventListeners();
        await this.checkAuthStatus();
        this.registerServiceWorker();
        this.updateOfflineBanner();
        this.hideLoader();
    }

    initTheme() {
        const storedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', storedTheme);
    }

    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('IMENDITrans', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => { this.db = request.result; resolve(); };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('sync-queue')) {
                    db.createObjectStore('sync-queue', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('app-state')) {
                    db.createObjectStore('app-state');
                }
            };
        });
    }

    setupEventListeners() {
        // Auth
        document.getElementById('login-tab').addEventListener('click', () => this.switchAuthTab('login'));
        document.getElementById('register-tab').addEventListener('click', () => this.switchAuthTab('register'));
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('register-form').addEventListener('submit', (e) => this.handleRegister(e));

        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', (e) => this.handleNavigation(e)));

        // Mobile Menu
        document.getElementById('mobile-menu-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent click from bubbling up to content-wrapper
            this.toggleMobileMenu();
        });
        document.getElementById('content-wrapper').addEventListener('click', () => this.closeMobileMenu());

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());

        // New Bon
        document.getElementById('add-luggage').addEventListener('click', () => this.addLuggageItem(null));
        document.getElementById('cancel-bon').addEventListener('click', () => this.cancelBon());
        document.getElementById('quick-create-bon').addEventListener('click', () => this.navigateTo('new-bon'));
        document.querySelectorAll('.navigate-new-bon').forEach(btn => btn.addEventListener('click', () => this.navigateTo('new-bon')));
        document.getElementById('bon-form').addEventListener('submit', (e) => this.handleBonFormSubmit(e));

        // History
        document.getElementById('search-input').addEventListener('input', (e) => this.searchBons(e.target.value));

        // Statistics
        document.getElementById('apply-filters').addEventListener('click', () => this.loadStatistics());

        // Settings
        document.getElementById('save-username').addEventListener('click', () => this.saveUsername());

        // Online/Offline detection
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // Modal
        document.getElementById('confirm-modal-btn').addEventListener('click', () => this.confirmModalAction());
        document.getElementById('cancel-modal-btn').addEventListener('click', () => this.hideConfirmationModal());
        document.getElementById('confirmation-modal').addEventListener('click', (e) => {
            if (e.target.id === 'confirmation-modal') this.hideConfirmationModal();
        });

        // Service Worker Listener
        this.setupServiceWorkerListener();
    }
    
    setupServiceWorkerListener() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', event => {
                if (event.data && event.data.type === 'SYNC_ERROR') {
                    this.showMessage(event.data.payload.message, 'error');
                }
            });
        }
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('/sw.js');
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }

    switchAuthTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(form => form.classList.add('hidden'));
        
        if (tab === 'login') {
            document.getElementById('login-tab').classList.add('active');
            document.getElementById('login-form').classList.remove('hidden');
        } else {
            document.getElementById('register-tab').classList.add('active');
            document.getElementById('register-form').classList.remove('hidden');
        }
    }

    async handleLogin(event) {
        event.preventDefault();
        this.showLoader();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        try {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`},
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('access_token', data.access_token);
                localStorage.setItem('refresh_token', data.refresh_token);
                
                try {
                    const tx = this.db.transaction(['app-state'], 'readwrite');
                    const store = tx.objectStore('app-state');
                    store.put(data.access_token, 'access_token');
                    store.put(data.refresh_token, 'refresh_token');
                    tx.oncomplete = () => {
                         this.currentUser = data.user;
                         this.showPage('main-app');
                         this.navigateTo('dashboard');
                    };
                    tx.onerror = (e) => {
                        console.error('Transaction error saving tokens:', e.target.error);
                        this.currentUser = data.user;
                        this.showPage('main-app');
                        this.navigateTo('dashboard');
                    };
                } catch(e) {
                    console.error('Could not initiate transaction to save tokens to IndexedDB.', e);
                    this.currentUser = data.user;
                    this.showPage('main-app');
                    this.navigateTo('dashboard');
                }
            } else {
                this.showMessage(data.error_description || 'Identifiants incorrects', 'error');
            }
        } catch (error) {
            this.showMessage('Erreur de connexion', 'error');
        } finally {
            this.hideLoader();
        }
    }

    async handleRegister(event) {
        event.preventDefault();
        this.showLoader();
        
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;
        const username = document.getElementById('register-username').value.trim();

        if (password !== confirmPassword) {
            this.showMessage('Les mots de passe ne correspondent pas', 'error');
            this.hideLoader();
            return;
        }
        if (!username) {
            this.showMessage('Veuillez entrer un nom d\'utilisateur', 'error');
            this.hideLoader();
            return;
        }

        try {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
                body: JSON.stringify({ email, password, data: { username: username } })
            });
            const data = await response.json();

            if (data.user) {
                this.showMessage('Compte créé avec succès ! Redirection vers la connexion...', 'success');
                setTimeout(() => {
                    this.switchAuthTab('login');
                    document.getElementById('login-email').value = email;
                }, 2000);
            } else {
                 this.showMessage(data.msg || 'Erreur lors de l\'inscription', 'error');
            }

        } catch (error) {
            this.showMessage('Erreur lors de l\'inscription', 'error');
        } finally {
            this.hideLoader();
        }
    }

    async checkAuthStatus() {
        const token = localStorage.getItem('access_token');
        if (token) {
            try {
                const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY }});
                if (response.ok) {
                    this.currentUser = await response.json();
                    this.showPage('main-app');
                    const savedView = localStorage.getItem('currentView') || 'dashboard';
                    this.navigateTo(savedView);
                } else {
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('refresh_token');
                    this.showPage('auth-page');
                }
            } catch (error) {
                this.showPage('auth-page');
            }
        } else {
            this.showPage('auth-page');
        }
    }

    handleNavigation(event) {
        event.preventDefault();
        const target = event.currentTarget.getAttribute('href').substring(1);
        this.navigateTo(target);
    }
    
    navigateTo(view) {
        if (!document.getElementById(`${view}-page`)) return;

        const currentActivePage = document.querySelector('.page:not(.hidden)');
        if (currentActivePage) {
            currentActivePage.classList.add('hidden');
        }
        
        const newPage = document.getElementById(`${view}-page`);
        newPage.classList.remove('hidden');
        newPage.classList.add('page-transition');
        
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${view}`) {
                link.classList.add('active');
            }
        });
        
        this.currentView = view;
        localStorage.setItem('currentView', view);
        
        switch (view) {
            case 'dashboard': this.loadDashboard(); break;
            case 'new-bon': this.loadNewBon(); break;
            case 'history': this.loadHistory(); break;
            case 'stats': this.loadStatistics(); break;
            case 'settings': this.loadSettings(); break;
        }

        this.closeMobileMenu();
        setTimeout(() => newPage.classList.remove('page-transition'), 400);
    }

    toggleMobileMenu() {
        const sidebar = document.getElementById('sidebar');
        const menuBtn = document.getElementById('mobile-menu-btn');
        const contentWrapper = document.getElementById('content-wrapper');
        const isOpen = sidebar.classList.toggle('open');
        menuBtn.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', isOpen);
        contentWrapper.classList.toggle('menu-open', isOpen);
    }

    closeMobileMenu() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('open')) {
            this.toggleMobileMenu();
        }
    }

    async handleLogout() {
        localStorage.clear();
        this.currentUser = null;
        this.showPage('auth-page');
        
        // Clear from IndexedDB
        try {
            const tx = this.db.transaction(['app-state'], 'readwrite');
            tx.onerror = (e) => console.error('Transaction error deleting tokens:', e.target.error);
            const store = tx.objectStore('app-state');
            store.delete('access_token');
            store.delete('refresh_token');
        } catch(e) {
            console.error('Could not initiate transaction to delete tokens from IndexedDB.', e);
        }
    }

    showPage(pageId) {
        document.querySelectorAll('#app > div').forEach(div => div.classList.add('hidden'));
        document.getElementById(pageId).classList.remove('hidden');
    }

    addLuggageItem(itemData = null) {
        const container = document.getElementById('luggage-container');
        const item = document.createElement('div');
        item.className = 'luggage-item';
        item.innerHTML = `
            <input type="text" class="luggage-type" placeholder="Type d'article" required value="${itemData ? itemData.type : ''}">
            <input type="number" class="luggage-quantity" placeholder="Quantité" min="1" required value="${itemData ? itemData.quantity : ''}">
            <button type="button" class="remove-luggage btn btn-danger btn-icon" aria-label="Supprimer l'article">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>
            </button>
        `;
        container.appendChild(item);
        item.querySelector('.remove-luggage').addEventListener('click', () => { item.remove(); this.updateTotalColis(); });
        item.querySelector('.luggage-quantity').addEventListener('input', () => this.updateTotalColis());
        this.updateTotalColis();
    }

    updateTotalColis() {
        let total = 0;
        document.querySelectorAll('.luggage-quantity').forEach(input => {
            total += parseInt(input.value) || 0;
        });
        document.getElementById('total-colis').textContent = total;
    }
    
    handleBonFormSubmit(event) {
        event.preventDefault();

        const bonIdField = document.getElementById('bon-id-field');
        if (!bonIdField.readOnly) {
            const bonIdValue = bonIdField.value.trim();
            const bonIdRegex = /^BON-\d{4}-\d{4,}$/;
            if (!bonIdRegex.test(bonIdValue)) {
                this.showMessage("Le N° de bon manuel est invalide. Format attendu: BON-AAAA-NNNN (ex: BON-2024-0001)", 'error');
                return;
            }
        }

        this.pendingBonData = this.getFormData();
        if (!this.pendingBonData.user_id) {
            this.showMessage("Erreur de session, impossible de sauvegarder. Veuillez vous reconnecter.", "error");
            return;
        }
        const isEditing = !!document.getElementById('bon-form').dataset.editingId;
        const title = isEditing ? 'Confirmer la modification' : 'Confirmer la création';
        const message = isEditing ? 'Voulez-vous vraiment enregistrer les modifications de ce bon ?' : 'Voulez-vous vraiment créer ce nouveau bon ?';
        this.showConfirmationModal(title, message, () => this.saveBon());
    }

    async saveBon() {
        this.showLoader();
        const isEditing = !!document.getElementById('bon-form').dataset.editingId;
        let formData = this.pendingBonData;

        try {
            if (!formData || !formData.user_id) {
                throw new Error("Session invalide ou données manquantes.");
            }

            if (isEditing) {
                const { id, ...updateData } = formData;
                await this.updateSupabaseBon(id, updateData);
                this.showMessage('Bon mis à jour avec succès !', 'success');
            } else {
                if (this.offlineMode) {
                    await this.storeOffline(formData);
                    this.showMessage('Bon sauvegardé localement. Il sera synchronisé plus tard.', 'info');
                } else {
                    try {
                        await this.submitToSupabase(formData);
                         this.showMessage('Bon enregistré avec succès !', 'success');
                    } catch (error) {
                        if (error.message === "DUPLICATE_ID") {
                            console.warn("Duplicate ID detected, attempting to recover.");
                            this.showMessage('Ce N° de bon existe déjà. Veuillez en utiliser un autre.', 'error');
                            // Make field editable again if it was manual
                             const bonIdField = document.getElementById('bon-id-field');
                             if (!document.getElementById('bon-form').dataset.editingId) {
                                bonIdField.readOnly = false;
                             }
                            return; // Stop execution
                        } else {
                            throw error;
                        }
                    }
                }
                
                const bonIdRegex = /^BON-\d{4}-(\d+)$/;
                const match = formData.id.match(bonIdRegex);
                if (match) {
                    const savedNumber = parseInt(match[1], 10);
                    this.lastGeneratedNumber = Math.max(this.lastGeneratedNumber, savedNumber);
                    localStorage.setItem('lastGeneratedNumber', this.lastGeneratedNumber.toString());
                }
            }
            this.navigateTo('history');
        } catch (error) {
            this.showMessage(`Erreur: ${error.message}`, 'error');
            console.error("Save Bon Error:", error);
        } finally {
            this.hideLoader();
            this.pendingBonData = null;
        }
    }

    getFormData() {
        return {
            id: document.getElementById('bon-id-field').value.trim(),
            sender_first_name: document.getElementById('sender-first-name').value,
            sender_last_name: document.getElementById('sender-last-name').value,
            sender_phone: document.getElementById('sender-phone').value,
            sender_cin: document.getElementById('sender-cin').value,
            recipient_first_name: document.getElementById('recipient-first-name').value,
            recipient_last_name: document.getElementById('recipient-last-name').value,
            recipient_phone: document.getElementById('recipient-phone').value,
            recipient_cin: document.getElementById('recipient-cin').value,
            origin: document.getElementById('origin').value,
            destination: document.getElementById('destination').value,
            luggage: Array.from(document.querySelectorAll('.luggage-item')).map(item => ({
                type: item.querySelector('.luggage-type').value,
                quantity: parseInt(item.querySelector('.luggage-quantity').value)
            })).filter(i => i.type && i.quantity > 0),
            total: parseFloat(document.getElementById('total').value),
            paid: document.getElementById('paid').checked,
            user_id: this.currentUser ? this.currentUser.id : null
        };
    }
    
    async submitToSupabase(data) {
        if (!this.currentUser || !this.currentUser.id) {
            throw new Error("Session invalide. Impossible d'enregistrer.");
        }
        const token = localStorage.getItem('access_token');
        const response = await fetch(`${SUPABASE_URL}/rest/v1/bons`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'apikey': SUPABASE_ANON_KEY, 
                'Authorization': `Bearer ${token}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Échec de la soumission à la base de données. Vérifiez votre connexion et les permissions (RLS).' }));
            if (response.status === 409 && errorData.code === '23505') {
                throw new Error("DUPLICATE_ID");
            }
            throw new Error(errorData.message || 'Une erreur de communication est survenue.');
        }
        return response.json();
    }

    async updateSupabaseBon(id, data) {
        if (!this.currentUser || !this.currentUser.id) {
            throw new Error("Session invalide. Impossible de mettre à jour.");
        }
        const token = localStorage.getItem('access_token');
        const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=eq.${id}`, {
            method: 'PATCH',
            headers: { 
                'Content-Type': 'application/json', 
                'apikey': SUPABASE_ANON_KEY, 
                'Authorization': `Bearer ${token}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Échec de la mise à jour. Vérifiez votre connexion et les permissions (RLS).' }));
            throw new Error(errorData.message || 'Une erreur de communication est survenue.');
        }
        return response.json();
    }

    async storeOffline(data) {
        await new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sync-queue'], 'readwrite');
            transaction.oncomplete = resolve;
            transaction.onerror = reject;
            const store = transaction.objectStore('sync-queue');
            store.add({ type: 'bon', data, timestamp: Date.now() });
        });

        if ('serviceWorker' in navigator && 'sync' in navigator.serviceWorker) {
            navigator.serviceWorker.ready.then(reg => reg.sync.register('sync-bons'));
        }
    }

    cancelBon() { this.navigateTo('dashboard'); }

    async loadDashboard() {
        this.showLoader();
        try {
            const username = await this.getUsernameFromProfile();
            document.getElementById('user-name').textContent = username || this.currentUser.email;
    
            const token = localStorage.getItem('access_token');
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
            // Step 1: Fetch bons
            const bonsResponse = await fetch(`${SUPABASE_URL}/rest/v1/bons?select=*&created_at=gte.${thirtyDaysAgo}&order=created_at.desc`, {
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
            });
            if (!bonsResponse.ok) {
                const errorData = await bonsResponse.json();
                throw new Error(errorData.message || "Failed to fetch dashboard bons");
            }
            const bons = await bonsResponse.json();
    
            // Step 2: Fetch profiles if there are bons
            if (bons.length > 0) {
                const userIds = [...new Set(bons.map(b => b.user_id).filter(id => id))];
                if (userIds.length > 0) {
                    const profilesResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,username&id=in.(${userIds.join(',')})`, {
                        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
                    });
                    if (profilesResponse.ok) {
                        const profiles = await profilesResponse.json();
                        const profilesMap = new Map(profiles.map(p => [p.id, p.username]));
                        // Step 3: Combine data
                        bons.forEach(bon => {
                            bon.profiles = { username: profilesMap.get(bon.user_id) || 'Inconnu' };
                        });
                    }
                }
            }
    
            // Step 4: Update UI
            const totalRevenue = bons.reduce((sum, bon) => sum + (bon.total || 0), 0);
            document.getElementById('dashboard-bons-count').textContent = bons.length;
            document.getElementById('dashboard-revenue').textContent = `${totalRevenue.toFixed(2)} €`;
    
            const container = document.getElementById('recent-bons-list');
            const emptyState = container.querySelector('.empty-state');
            const recentBons = bons.slice(0, 3);
    
            container.querySelectorAll('.recent-bon-item').forEach(el => el.remove());
    
            if (recentBons.length === 0) {
                emptyState.classList.remove('hidden');
            } else {
                emptyState.classList.add('hidden');
                recentBons.forEach(bon => {
                    const item = document.createElement('div');
                    item.className = 'recent-bon-item';
                    item.innerHTML = `
                        <div>
                            <strong>${bon.id}</strong>: ${bon.sender_first_name} à ${bon.recipient_first_name}<br>
                            <small>${bon.origin} → ${bon.destination} | Créé par: ${bon.profiles && bon.profiles.username ? bon.profiles.username : 'Inconnu'}</small>
                        </div>
                        <span class="status-badge ${bon.paid ? 'status-paid' : 'status-unpaid'}">${bon.paid ? 'Payé' : 'Non Payé'}</span>
                    `;
                    container.appendChild(item);
                });
            }
        } catch (error) {
            this.showMessage(`Erreur chargement dashboard: ${error.message}`, 'error');
        } finally {
            this.hideLoader();
        }
    }
    
    async loadNewBon(bon = null) {
        const form = document.getElementById('bon-form');
        form.reset();
        document.getElementById('luggage-container').innerHTML = '';
        const bonIdField = document.getElementById('bon-id-field');
        const manualHelper = document.getElementById('bon-id-manual-helper');

        const toggleFormState = (enabled) => {
            form.querySelectorAll('input:not(#bon-id-field), button:not(#cancel-bon)').forEach(el => {
                el.disabled = !enabled;
            });
            form.querySelector('button[type="submit"]').disabled = !enabled;
        };
        
        delete form.dataset.editingId;
        manualHelper.classList.add('hidden');
        bonIdField.readOnly = true;
    
        if (bon) { // Editing existing bon
            document.getElementById('bon-form-title').textContent = 'Modifier le Bon';
            form.dataset.editingId = bon.id;
            bonIdField.value = bon.id;
    
            Object.keys(bon).forEach(key => {
                const elId = key.replace(/_/g, '-');
                const el = document.getElementById(elId);
                if (el) {
                    if (el.type === 'checkbox') el.checked = bon[key];
                    else el.value = bon[key];
                }
            });
            (bon.luggage || []).forEach(item => this.addLuggageItem(item));
            toggleFormState(true);
    
        } else { // Creating new bon
            document.getElementById('bon-form-title').textContent = 'Nouveau Bon';
            bonIdField.value = '';
            bonIdField.placeholder = 'Génération en cours...';
            toggleFormState(false);
    
            if (!navigator.onLine) {
                const lastNumber = this.lastGeneratedNumber;
                const year = new Date().getFullYear();
                const nextNum = lastNumber + 1;
                bonIdField.value = `BON-${year}-${nextNum.toString().padStart(4, '0')}`;
                this.addLuggageItem();
                toggleFormState(true);
                this.updateTotalColis();
                return;
            }
    
            try {
                const token = localStorage.getItem('access_token');
                if (!token || !this.currentUser || !this.currentUser.id) throw new Error("AUTH_ERROR");
    
                const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?select=id&order=id.desc&limit=1`, 
                    { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } }
                );
    
                if (response.status === 401) throw new Error("AUTH_ERROR");
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: `Le serveur a répondu avec une erreur (${response.status})` }));
                    throw new Error(errorData.message);
                }
    
                const bons = await response.json();
                if (bons.length > 0) {
                    const lastId = bons[0].id;
                    const parts = lastId.split('-');
                    let lastNumber = 0;
                    if (parts.length === 3) {
                       lastNumber = parseInt(parts[2], 10) || 0;
                    }
                    const year = new Date().getFullYear();
                    const nextNum = lastNumber + 1;
                    bonIdField.value = `BON-${year}-${nextNum.toString().padStart(4, '0')}`;
                } else {
                    // No history, enable manual input
                    manualHelper.classList.remove('hidden');
                    bonIdField.readOnly = false;
                    bonIdField.placeholder = 'Ex: BON-2024-0001';
                }
                
                this.addLuggageItem();
                toggleFormState(true);
    
            } catch (error) {
                if (error.message === "AUTH_ERROR") { await this.handleLogout(); return; }
    
                console.warn("Could not sync bon number, falling back to local cache.", error);
                const year = new Date().getFullYear();
                const lastNumber = this.lastGeneratedNumber;
                const nextNum = lastNumber + 1;
                bonIdField.value = `BON-${year}-${nextNum.toString().padStart(4, '0')}`;
                this.addLuggageItem();
                toggleFormState(true);
            }
        }
        this.updateTotalColis();
    }

    async loadHistory() {
        this.showLoader();
        try {
            const token = localStorage.getItem('access_token');
    
            // Step 1: Fetch bons
            const bonsResponse = await fetch(`${SUPABASE_URL}/rest/v1/bons?select=*&order=created_at.desc`, {
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
            });
            if (!bonsResponse.ok) {
                const errorData = await bonsResponse.json();
                throw new Error(errorData.message || "Failed to fetch history");
            }
            const bons = await bonsResponse.json();
    
            // Step 2: Fetch profiles
            if (bons.length > 0) {
                const userIds = [...new Set(bons.map(b => b.user_id).filter(id => id))];
                if (userIds.length > 0) {
                    const profilesResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,username&id=in.(${userIds.join(',')})`, {
                        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
                    });
                    if (profilesResponse.ok) {
                        const profiles = await profilesResponse.json();
                        const profilesMap = new Map(profiles.map(p => [p.id, p.username]));
                        // Step 3: Combine data
                        bons.forEach(bon => {
                            bon.profiles = { username: profilesMap.get(bon.user_id) || 'Inconnu' };
                        });
                    } else {
                        // Handle case where profiles can't be fetched, but don't crash.
                        bons.forEach(bon => {
                            bon.profiles = { username: 'Inconnu' };
                        });
                    }
                }
            }
    
            // Step 4: Update UI
            this.displayHistory(bons);
            document.getElementById('history-empty-state').classList.toggle('hidden', bons.length > 0);
        } catch (error) {
            this.showMessage(`Erreur chargement historique: ${error.message}`, 'error');
        } finally {
            this.hideLoader();
        }
    }

    displayHistory(bons) {
        const tbody = document.getElementById('history-table-body');
        tbody.innerHTML = bons.map(bon => `
            <tr>
                <td>${bon.id}</td>
                <td>${bon.sender_first_name} ${bon.sender_last_name}</td>
                <td>${bon.recipient_first_name} ${bon.recipient_last_name}</td>
                <td>${bon.origin} → ${bon.destination}</td>
                <td>${new Date(bon.created_at).toLocaleDateString()}</td>
                <td>${bon.profiles && bon.profiles.username ? bon.profiles.username : 'Inconnu'}</td>
                <td>${(bon.total || 0).toFixed(2)} €</td>
                <td><span class="status-badge ${bon.paid ? 'status-paid' : 'status-unpaid'}">${bon.paid ? 'Payé' : 'Non Payé'}</span></td>
                <td class="actions-cell">
                    <button class="btn btn-secondary btn-icon edit-btn" data-id='${JSON.stringify(bon)}' aria-label="Modifier">
                       <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg>
                    </button>
                    <button class="btn btn-secondary btn-icon share-btn" data-id="${bon.id}" aria-label="Partager">
                       <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"></path></svg>
                    </button>
                    <button class="btn btn-secondary btn-icon print-btn" data-id="${bon.id}" aria-label="Imprimer le PDF">
                       <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"></path></svg>
                    </button>
                </td>
            </tr>`).join('');

        tbody.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', (e) => {
            const bonData = JSON.parse(e.currentTarget.dataset.id);
            this.navigateTo('new-bon');
            this.loadNewBon(bonData);
        }));
        tbody.querySelectorAll('.share-btn').forEach(btn => btn.addEventListener('click', (e) => this.shareBon(e.currentTarget.dataset.id)));
        tbody.querySelectorAll('.print-btn').forEach(btn => btn.addEventListener('click', (e) => this.exportPDF(e.currentTarget.dataset.id)));
    }

    async loadStatistics() {
        this.showLoader();
        try {
            const token = localStorage.getItem('access_token');
            const startDate = document.getElementById('start-date').value;
            const endDate = document.getElementById('end-date').value;
            let url = `${SUPABASE_URL}/rest/v1/bons`;
            const queryParams = [];
            if (startDate && endDate) {
                queryParams.push(`created_at=gte.${startDate}T00:00:00`);
                queryParams.push(`created_at=lte.${endDate}T23:59:59`);
            }
            if (queryParams.length > 0) {
                url += `?${queryParams.join('&')}`;
            }

            const response = await fetch(url, { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }});
            if (response.ok) {
                const bons = await response.json();
                const totals = bons.reduce((acc, bon) => {
                    const total = parseFloat(bon.total) || 0;
                    acc.totalRevenue += total;
                    if (bon.paid) { acc.paidAmount += total; acc.paidCount++; }
                    else { acc.unpaidAmount += total; acc.unpaidCount++; }
                    return acc;
                }, { totalRevenue: 0, paidAmount: 0, unpaidAmount: 0, paidCount: 0, unpaidCount: 0 });

                document.getElementById('total-revenue').textContent = `${totals.totalRevenue.toFixed(2)} €`;
                document.getElementById('paid-amount').textContent = `${totals.paidAmount.toFixed(2)} €`;
                document.getElementById('paid-count').textContent = `${totals.paidCount} bons`;
                document.getElementById('unpaid-amount').textContent = `${totals.unpaidAmount.toFixed(2)} €`;
                document.getElementById('unpaid-count').textContent = `${totals.unpaidCount} bons`;
            } else {
                const errorData = await response.json();
                throw new Error(errorData.message);
            }
        } catch (error) {
            this.showMessage(`Erreur chargement statistiques: ${error.message}`, 'error');
        } finally {
            this.hideLoader();
        }
    }
    
    async loadSettings() {
        this.showLoader();
        try {
            const username = await this.getUsernameFromProfile();
            document.getElementById('username-setting').value = username || '';
            
            const themeToggle = document.getElementById('theme-toggle');
            if (!themeToggle.dataset.listener) {
                themeToggle.addEventListener('click', () => {
                    let newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                    document.documentElement.setAttribute('data-theme', newTheme);
                    localStorage.setItem('theme', newTheme);
                });
                themeToggle.dataset.listener = true;
            }

        } catch (error) {
            this.showMessage("Erreur de chargement du profil", "error");
        } finally {
            this.hideLoader();
        }
    }
    
    async getUsernameFromProfile() {
        const token = localStorage.getItem('access_token');
        const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}&select=username`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return null;
        const profiles = await response.json();
        return profiles.length > 0 ? profiles[0].username : null;
    }

    async saveUsername() {
        const username = document.getElementById('username-setting').value.trim();
        if (!username) { this.showMessage('Le nom d\'utilisateur ne peut pas être vide', 'warning'); return; }
        this.showLoader();
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`},
                body: JSON.stringify({ username: username })
            });
            if (!response.ok) throw new Error("Update failed");
            document.getElementById('user-name').textContent = username;
            this.showMessage('Nom d\'utilisateur sauvegardé', 'success');
        } catch (error) {
            this.showMessage('Erreur lors de la sauvegarde', 'error');
        } finally {
            this.hideLoader();
        }
    }

    searchBons(query) {
        document.querySelectorAll('#history-table-body tr').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(query.toLowerCase()) ? '' : 'none';
        });
    }

    handleOnline() { this.offlineMode = false; this.updateOfflineBanner(); this.syncOfflineData(); }
    handleOffline() { this.offlineMode = true; this.updateOfflineBanner(); }

    updateOfflineBanner() {
        document.getElementById('offline-banner').classList.toggle('hidden', !this.offlineMode);
    }

    async syncOfflineData() {
        if ('serviceWorker' in navigator && 'sync' in navigator.serviceWorker) {
            navigator.serviceWorker.ready.then(reg => reg.sync.register('sync-bons'));
        }
    }
    
    showConfirmationModal(title, message, onConfirm) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-message').textContent = message;
        this.onConfirm = onConfirm;
        document.getElementById('confirmation-modal').classList.remove('hidden');
    }
    
    hideConfirmationModal() {
        document.getElementById('confirmation-modal').classList.add('hidden');
        this.onConfirm = null;
        this.pendingBonData = null;
    }
    
    confirmModalAction() {
        if (this.onConfirm) {
            this.onConfirm();
        }
        this.hideConfirmationModal();
    }

    showMessage(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 5000); // Increased duration for error messages
    }

    showLoader() { document.getElementById('loader-overlay').classList.remove('hidden'); }
    hideLoader() { document.getElementById('loader-overlay').classList.add('hidden'); }
    
    async fetchBonData(id) {
        const token = localStorage.getItem('access_token');
        const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=eq.${id}`, { headers: {'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`}});
        if (!response.ok) throw new Error('Failed to fetch bon data.');
        const bons = await response.json();
        if (bons.length === 0) throw new Error('Bon non trouvé');
        return bons[0];
    }

    createBonHTMLElement(bon) {
        const bonElement = document.createElement('div');
        bonElement.className = 'bon-render-container';
        Object.assign(bonElement.style, {
            position: 'absolute',
            left: '-9999px',
            width: '800px',
            padding: '40px',
            fontFamily: 'Arial, sans-serif',
            backgroundColor: '#ffffff',
            color: '#333',
            boxSizing: 'border-box',
            minHeight: '1131px', // A4 aspect ratio for 800px width
        });

        const statusColor = bon.paid ? '#22c55e' : '#ef4444';
        const senderName = `${bon.sender_first_name || ''} ${bon.sender_last_name || ''}`.trim();
        const recipientName = `${bon.recipient_first_name || ''} ${bon.recipient_last_name || ''}`.trim();

        bonElement.innerHTML = `
            <div style="background-color: #1E3A8A; color: white; padding: 30px; text-align: center; margin: -40px -40px 40px -40px;">
                <h2 style="margin: 0; font-size: 2.5em; font-weight: bold; color: white;">IMENDI TRANS</h2>
                <p style="margin: 10px 0 0; font-size: 2.5em; font-weight: bold; color: white;">BON D'EXPÉDITION</p>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px;">
                <div style="font-size: 1.2em;">
                    <strong>Numéro:</strong> ${bon.id}
                </div>
                <div style="font-size: 1.2em; text-align: right;">
                    <strong>Date:</strong> ${new Date(bon.created_at).toLocaleDateString('fr-FR')}
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px; border-top: 2px solid #eee; padding-top: 30px;">
                <div>
                    <h3 style="font-size: 1.5em; color: #1E3A8A; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid #1E3A8A; padding-bottom: 5px;">Expéditeur</h3>
                    <p style="margin: 8px 0; font-size: 1.2em;"><strong>Nom:</strong> ${senderName}</p>
                    <p style="margin: 8px 0; font-size: 1.2em;"><strong>Tél:</strong> ${bon.sender_phone || 'N/A'}</p>
                    <p style="margin: 8px 0; font-size: 1.2em;"><strong>CIN:</strong> ${bon.sender_cin || 'N/A'}</p>
                </div>
                <div>
                    <h3 style="font-size: 1.5em; color: #1E3A8A; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid #1E3A8A; padding-bottom: 5px;">Destinataire</h3>
                    <p style="margin: 8px 0; font-size: 1.2em;"><strong>Nom:</strong> ${recipientName}</p>
                    <p style="margin: 8px 0; font-size: 1.2em;"><strong>Tél:</strong> ${bon.recipient_phone || 'N/A'}</p>
                    <p style="margin: 8px 0; font-size: 1.2em;"><strong>CIN:</strong> ${bon.recipient_cin || 'N/A'}</p>
                </div>
            </div>
            <div style="border-top: 2px solid #eee; padding-top: 30px; margin-bottom: 30px;">
                <h3 style="font-size: 1.5em; color: #1E3A8A; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid #1E3A8A; padding-bottom: 5px;">Détails de l'expédition</h3>
                <p style="margin: 8px 0; font-size: 1.2em;"><strong>De:</strong> ${bon.origin || 'N/A'}</p>
                <p style="margin: 8px 0; font-size: 1.2em;"><strong>À:</strong> ${bon.destination || 'N/A'}</p>
            </div>
            
            <div style="margin-bottom: 40px;">
                <h3 style="font-size: 1.5em; color: #1E3A8A; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid #1E3A8A; padding-bottom: 5px;">Bagages</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 1.2em;">
                    <thead>
                        <tr style="background-color: #f3f4f6;">
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #1E3A8A;">Article</th>
                            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #1E3A8A;">Quantité</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${bon.luggage && bon.luggage.length > 0 ? bon.luggage.map(item => `
                            <tr style="border-bottom: 1px solid #ddd;">
                                <td style="padding: 12px;">${item.type}</td>
                                <td style="padding: 12px; text-align: right;">${item.quantity}</td>
                            </tr>
                        `).join('') : `<tr><td colspan="2" style="padding: 12px; text-align: center; color: #777;">Aucun bagage enregistré.</td></tr>`}
                    </tbody>
                </table>
            </div>

            <div style="border-top: 2px solid #eee; padding-top: 30px; text-align: right;">
                <p style="margin: 8px 0; font-size: 1.5em;"><strong>Total:</strong> ${(bon.total || 0).toFixed(2)} €</p>
                <p style="margin: 8px 0; font-size: 1.5em; font-weight: bold; color: ${statusColor};"><strong>Statut:</strong> ${bon.paid ? 'Payé' : 'Non Payé'}</p>
            </div>
            <div style="margin-top: 50px; text-align: center; font-size: 0.9em; color: #777; border-top: 1px solid #ccc; padding-top: 20px;">
                <p style="margin: 0;">Merci d'utiliser IMENDI TRANS</p>
            </div>
        `;
        return bonElement;
    }

    async shareBon(id) {
        if (!navigator.share) {
            this.showMessage('Le partage n\'est pas supporté sur ce navigateur.', 'info');
            return;
        }

        this.showLoader();
        try {
            const bon = await this.fetchBonData(id);
            const bonElement = this.createBonHTMLElement(bon);
            document.body.appendChild(bonElement);

            const canvas = await html2canvas(bonElement, { 
                scale: 2,
                useCORS: true
            });
            const dataUrl = canvas.toDataURL('image/png');
            const blob = await (await fetch(dataUrl)).blob();
            const file = new File([blob], `bon-${id}.png`, { type: 'image/png' });
            document.body.removeChild(bonElement);

            const shareData = {
                files: [file],
                title: `Bon d'expédition ${id}`,
                text: `Voici le bon d'expédition ${id} de IMENDI TRANS.`,
            };

            if (navigator.canShare && navigator.canShare(shareData)) {
                await navigator.share(shareData);
            } else {
                this.showMessage('Partage de fichiers non supporté.', 'info');
            }

        } catch (error) {
            console.error('Share error:', error);
            this.showMessage(`Erreur lors du partage: ${error.message}`, 'error');
        } finally {
            this.hideLoader();
        }
    }

    async exportPDF(id) {
        this.showLoader();
        try {
            const bon = await this.fetchBonData(id);
            const bonElement = this.createBonHTMLElement(bon);
            document.body.appendChild(bonElement);

            const canvas = await html2canvas(bonElement, {
                scale: 2,
                useCORS: true
            });
            document.body.removeChild(bonElement);

            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: 'p',
                unit: 'mm',
                format: 'a4'
            });

            const imgProps = doc.getImageProperties(imgData);
            const pdfWidth = doc.internal.pageSize.getWidth();
            const pdfHeight = doc.internal.pageSize.getHeight();
            const imgWidth = imgProps.width;
            const imgHeight = imgProps.height;

            const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);

            const w = imgWidth * ratio;
            const h = imgHeight * ratio;
            
            const x = (pdfWidth - w) / 2;
            const y = (pdfHeight - h) / 2;

            doc.addImage(imgData, 'JPEG', x, y, w, h);
            doc.save(`bon_${id}.pdf`);
        } catch (error) {
            console.error('PDF Export error:', error);
            this.showMessage('Erreur lors de la génération du PDF', 'error');
        } finally {
            this.hideLoader();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new IMENDITransApp(); });