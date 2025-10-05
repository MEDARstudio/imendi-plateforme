// Supabase configuration
const SUPABASE_URL = 'https://cxjftikjoskdeakoxhgr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4amZ0aWtqb3NrZGVha294aGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MDA1OTgsImV4cCI6MjA3NTA3NjU5OH0.CS2iXOABcX4QPY472eXW8MkxoQJXDiC_WzKWPhFtISY';

class IMENDITransApp {
    constructor() {
        this.currentUser = null;
        this.currentView = 'dashboard';
        this.offlineMode = !navigator.onLine;
        this.db = null;
        this.startNumber = parseInt(localStorage.getItem('startNumber') || '1000');
        this.nextNumber = this.startNumber;
        
        this.init();
    }

    async init() {
        await this.initDatabase();
        this.setupEventListeners();
        await this.checkAuthStatus();
        this.registerServiceWorker();
        this.updateOfflineBanner();
    }

    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('IMENDITrans', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('sync-queue')) {
                    const store = db.createObjectStore('sync-queue', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('type', 'type');
                    store.createIndex('timestamp', 'timestamp');
                }
            };
        });
    }

    setupEventListeners() {
        // Auth events
        document.getElementById('login-tab').addEventListener('click', () => this.switchAuthTab('login'));
        document.getElementById('register-tab').addEventListener('click', () => this.switchAuthTab('register'));
        document.getElementById('login-submit').addEventListener('click', (e) => this.handleLogin(e));
        document.getElementById('register-submit').addEventListener('click', (e) => this.handleRegister(e));

        // Navigation events
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => this.handleNavigation(e));
        });

        // Mobile menu
        document.getElementById('mobile-menu-btn').addEventListener('click', () => this.toggleMobileMenu());
        document.getElementById('logout-mobile-btn').addEventListener('click', () => this.handleLogout());

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());

        // New Bon events
        document.getElementById('add-luggage').addEventListener('click', () => this.addLuggageItem());
        document.getElementById('cancel-bon').addEventListener('click', () => this.cancelBon());
        document.getElementById('quick-create-bon').addEventListener('click', () => this.navigateTo('new-bon'));

        // History events
        document.getElementById('search-input').addEventListener('input', (e) => this.searchBons(e.target.value));

        // Statistics events
        document.getElementById('apply-filters').addEventListener('click', () => this.loadStatistics());

        // Settings events
        document.getElementById('save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('save-username').addEventListener('click', () => this.saveUsername());

        // Form submission
        document.getElementById('bon-form').addEventListener('submit', (e) => this.handleSubmitBon(e));

        // Online/Offline detection
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        // Remove luggage items
        document.getElementById('luggage-container').addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-luggage')) {
                const container = document.getElementById('luggage-container');
                if (container.children.length > 1) {
                    e.target.parentElement.remove();
                    this.updateTotalColis();
                }
            }
        });

        // Update total colis when luggage items change
        document.getElementById('luggage-container').addEventListener('input', (e) => {
            if (e.target.classList.contains('luggage-quantity')) {
                this.updateTotalColis();
            }
        });
        
        // Debug buttons
        if (document.getElementById('debug-network-btn')) {
            document.getElementById('debug-network-btn').addEventListener('click', () => this.debugNetwork());
            document.getElementById('debug-db-btn').addEventListener('click', () => this.debugDatabase());
        }
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('sw.js');
                console.log('Service Worker registered');
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
        
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const messageEl = document.getElementById('login-message');

        try {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('access_token', data.access_token);
                localStorage.setItem('refresh_token', data.refresh_token);
                this.currentUser = data.user;
                this.showPage('main-app');
                this.navigateTo('dashboard');
                await this.loadDashboard();
            } else {
                messageEl.textContent = data.error_description || 'Identifiants incorrects';
                messageEl.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Login error:', error);
            messageEl.textContent = 'Erreur de connexion';
            messageEl.classList.remove('hidden');
        }
    }

    async handleRegister(event) {
        event.preventDefault();
        
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;
        const username = document.getElementById('register-username').value.trim();
        const messageEl = document.getElementById('register-message');

        if (password !== confirmPassword) {
            messageEl.textContent = 'Les mots de passe ne correspondent pas';
            messageEl.classList.remove('hidden');
            return;
        }

        if (!username) {
            messageEl.textContent = 'Veuillez entrer un nom d\'utilisateur';
            messageEl.classList.remove('hidden');
            return;
        }

        try {
            // First, create the user
            const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                // After successful registration, create profile with username
                await this.createProfile(data.user.id, username);
                
                messageEl.textContent = 'Compte créé avec succès !';
                messageEl.className = 'message success';
                messageEl.classList.remove('hidden');
                
                // Auto-switch to login after 2 seconds
                setTimeout(() => {
                    this.switchAuthTab('login');
                    document.getElementById('login-email').value = email;
                    document.getElementById('register-email').value = '';
                    document.getElementById('register-password').value = '';
                    document.getElementById('register-confirm-password').value = '';
                    document.getElementById('register-username').value = '';
                    messageEl.classList.add('hidden');
                    messageEl.className = 'message hidden';
                }, 2000);
            } else {
                messageEl.textContent = data.error_description || 'Erreur lors de l\'inscription';
                messageEl.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Registration error:', error);
            messageEl.textContent = 'Erreur de connexion';
            messageEl.classList.remove('hidden');
        }
    }

    async createProfile(userId, username) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({ 
                    id: userId,
                    username: username,
                    full_name: username
                })
            });
            
            if (response.ok) {
                console.log('Profile created successfully');
            }
        } catch (error) {
            console.error('Error creating profile:', error);
        }
    }

    async checkAuthStatus() {
        const token = localStorage.getItem('access_token');
        if (token) {
            try {
                const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    this.currentUser = await response.json();
                    this.showPage('main-app');
                    await this.loadDashboard();
                } else {
                    this.showPage('auth-page');
                }
            } catch (error) {
                console.error('Auth check error:', error);
                this.showPage('auth-page');
            }
        } else {
            this.showPage('auth-page');
        }
    }

    handleNavigation(event) {
        event.preventDefault();
        const target = event.target.getAttribute('href').substring(1);
        this.navigateTo(target);
    }

    navigateTo(view) {
        // Update navigation active state
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${view}`) {
                link.classList.add('active');
            }
        });

        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            if (page.id !== 'auth-page' && page.id !== 'main-app') {
                page.classList.add('hidden');
            }
        });

        // Show target page
        const targetPage = document.getElementById(`${view}-page`);
        if (targetPage) {
            targetPage.classList.remove('hidden');
        }

        this.currentView = view;

        // Load specific content
        switch (view) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'new-bon':
                this.loadNewBon();
                break;
            case 'history':
                this.loadHistory();
                break;
            case 'stats':
                this.loadStatistics();
                break;
            case 'settings':
                this.loadSettings();
                break;
        }

        // Close mobile menu
        this.closeMobileMenu();
    }

    toggleMobileMenu() {
        const menu = document.getElementById('mobile-menu');
        menu.classList.toggle('hidden');
    }

    closeMobileMenu() {
        document.getElementById('mobile-menu').classList.add('hidden');
    }

    async handleLogout() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        this.currentUser = null;
        this.showPage('auth-page');
    }

    showPage(pageId) {
        document.querySelectorAll('#app > div').forEach(div => {
            div.classList.add('hidden');
        });
        document.getElementById(pageId).classList.remove('hidden');
    }

    addLuggageItem() {
        const container = document.getElementById('luggage-container');
        const item = document.createElement('div');
        item.className = 'luggage-item';
        item.innerHTML = `
            <input type="text" class="luggage-type" placeholder="Type d'article" required>
            <input type="number" class="luggage-quantity" placeholder="Quantité" min="1" required>
            <button type="button" class="remove-luggage btn btn-danger">Supprimer</button>
        `;
        container.appendChild(item);
        
        // Add event listener for quantity input
        item.querySelector('.luggage-quantity').addEventListener('input', () => {
            this.updateTotalColis();
        });
        
        this.updateTotalColis();
    }

    updateTotalColis() {
        let total = 0;
        document.querySelectorAll('.luggage-quantity').forEach(input => {
            const value = parseInt(input.value) || 0;
            total += value;
        });
        document.getElementById('total-colis').textContent = total;
    }

    async handleSubmitBon(event) {
        event.preventDefault();
        
        const formData = this.getFormData();
        
        try {
            console.log('Tentative de soumission du bon:', formData);
            
            if (this.offlineMode) {
                console.log('Mode hors ligne détecté');
                // Store in IndexedDB for later sync
                await this.storeOffline(formData);
                this.showMessage('Bon sauvegardé localement. Synchronisation automatique...', 'success');
                this.navigateTo('history');
            } else {
                console.log('Mode en ligne - envoi au serveur');
                // Submit to Supabase
                const result = await this.submitToSupabase(formData);
                console.log('Résultat de l\'envoi:', result);
                
                if (result.success) {
                    this.showMessage('Bon enregistré avec succès !', 'success');
                    this.navigateTo('history');
                } else {
                    console.log('Échec de l\'envoi - sauvegarde locale');
                    // If Supabase fails, store offline
                    await this.storeOffline(formData);
                    this.showMessage('Erreur réseau. Sauvegardé localement...', 'warning');
                    this.navigateTo('history');
                }
            }
        } catch (error) {
            console.error('Erreur détaillée lors de la soumission:', error);
            
            // Même en cas d'erreur, on sauvegarde localement
            try {
                await this.storeOffline(formData);
                this.showMessage('Erreur lors de l\'enregistrement. Sauvegardé localement.', 'warning');
                this.navigateTo('history');
            } catch (storageError) {
                console.error('Erreur critique de sauvegarde locale:', storageError);
                this.showMessage('Erreur critique lors de la sauvegarde: ' + storageError.message, 'error');
            }
        }
    }

    getFormData() {
        const luggage = [];
        document.querySelectorAll('.luggage-item').forEach(item => {
            const type = item.querySelector('.luggage-type').value;
            const quantity = parseInt(item.querySelector('.luggage-quantity').value);
            if (type && quantity && !isNaN(quantity)) {
                luggage.push({ type, quantity });
            }
        });

        return {
            id: document.getElementById('bon-id').value || document.getElementById('current-bon-id').textContent,
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
            luggage: luggage,
            total: parseFloat(document.getElementById('total').value) || 0,
            paid: document.getElementById('paid').checked,
            user_id: this.currentUser.id,
            created_at: new Date().toISOString()
        };
    }

    async generateId() {
        const year = new Date().getFullYear();
        const prefix = `BON-${year}-`;
        
        // Use the current start number from localStorage
        this.startNumber = parseInt(localStorage.getItem('startNumber') || '1000');
        
        // Get the highest number from the database for this year
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?user_id=eq.${this.currentUser.id}&id=like.BON-${year}-%&order=id.desc&limit=1`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            let nextNum = this.startNumber;
            if (response.ok) {
                const result = await response.json();
                if (result.length > 0) {
                    const lastId = result[0].id;
                    const lastNumber = parseInt(lastId.split('-')[2]);
                    nextNum = lastNumber + 1;
                } else {
                    // No existing bons for this year, use start number
                    nextNum = this.startNumber;
                }
            } else {
                // If API call fails, use local counter
                nextNum = this.nextNumber;
                this.nextNumber++;
            }
            
            const id = `${prefix}${nextNum.toString().padStart(4, '0')}`;
            return id;
        } catch (error) {
            // If network fails, use local counter
            const id = `${prefix}${this.nextNumber.toString().padStart(4, '0')}`;
            this.nextNumber++;
            return id;
        }
    }

    async submitToSupabase(data) {
        try {
            const token = localStorage.getItem('access_token');
            console.log('Token d\'accès:', token ? 'Présent' : 'Absent');
            
            if (!token) {
                throw new Error('Token d\'accès manquant - veuillez vous reconnecter');
            }
            
            console.log('Données à envoyer:', data);
            
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

            console.log('Statut de la réponse:', response.status);
            console.log('Headers de la réponse:', [...response.headers.entries()]);
            
            if (response.ok) {
                const responseData = await response.json();
                console.log('Réponse réussie:', responseData);
                return { success: true,  responseData };
            } else {
                const errorText = await response.text();
                console.error('Erreur HTTP:', response.status, errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error('Erreur Supabase:', error);
            return { success: false, error: error.message };
        }
    }

    async storeOffline(data) {
        try {
            console.log('Tentative de sauvegarde locale');
            
            if (!this.db) {
                console.log('Base de données non initialisée, tentative d\'initialisation...');
                await this.initDatabase();
                if (!this.db) {
                    throw new Error('Impossible d\'initialiser la base de données');
                }
            }
            
            const transaction = this.db.transaction(['sync-queue'], 'readwrite');
            const store = transaction.objectStore('sync-queue');
            
            const result = await store.add({
                type: 'bon',
                 data,
                timestamp: Date.now()
            });
            
            console.log('Données sauvegardées localement avec ID:', result);
            
            // Register sync
            if ('serviceWorker' in navigator && 'sync' in navigator.serviceWorker) {
                try {
                    const registration = await navigator.serviceWorker.ready;
                    await registration.sync.register('sync-bons');
                    console.log('Sync registered');
                } catch (syncError) {
                    console.warn('Sync registration failed:', syncError);
                }
            }
            
            return result;
        } catch (error) {
            console.error('Erreur de sauvegarde locale:', error);
            throw new Error('Impossible de sauvegarder localement: ' + error.message);
        }
    }

    cancelBon() {
        this.navigateTo('history');
    }

    async loadDashboard() {
        // Load username from profiles table
        const username = await this.getUsernameFromProfile();
        document.getElementById('user-name').textContent = username || this.currentUser.email;
        
        // Load recent bons
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?user_id=eq.${this.currentUser.id}&order=created_at.desc&limit=3`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bons = await response.json();
                const container = document.getElementById('recent-bons');
                
                if (bons.length === 0) {
                    container.innerHTML = '<p>Aucun bon récent</p>';
                } else {
                    container.innerHTML = bons.map(bon => `
                        <div class="recent-bon">
                            <strong>${bon.id}</strong><br>
                            <small>${bon.origin} → ${bon.destination}</small><br>
                            <small>${bon.sender_first_name} ${bon.sender_last_name}</small>
                        </div>
                    `).join('');
                }
            }
        } catch (error) {
            console.error('Error loading dashboard:', error);
        }
    }

    async loadNewBon(bon = null) {
        // Reset form
        document.getElementById('bon-form').reset();
        document.getElementById('bon-id').value = '';
        document.getElementById('paid').checked = false;

        // Set the start number for ID generation (use the current value from localStorage)
        this.startNumber = parseInt(localStorage.getItem('startNumber') || '1000');
        document.getElementById('start-number').value = this.startNumber;

        // Clear luggage items except first one
        const container = document.getElementById('luggage-container');
        while (container.children.length > 1) {
            container.removeChild(container.lastChild);
        }

        if (bon) {
            // Editing existing bon
            document.getElementById('bon-form-title').textContent = 'Modifier le Bon';
            document.getElementById('current-bon-id').textContent = bon.id;
            document.getElementById('bon-id').value = bon.id;
            document.getElementById('sender-first-name').value = bon.sender_first_name;
            document.getElementById('sender-last-name').value = bon.sender_last_name;
            document.getElementById('sender-phone').value = bon.sender_phone;
            document.getElementById('sender-cin').value = bon.sender_cin;
            document.getElementById('recipient-first-name').value = bon.recipient_first_name;
            document.getElementById('recipient-last-name').value = bon.recipient_last_name;
            document.getElementById('recipient-phone').value = bon.recipient_phone;
            document.getElementById('recipient-cin').value = bon.recipient_cin;
            document.getElementById('origin').value = bon.origin;
            document.getElementById('destination').value = bon.destination;
            document.getElementById('total').value = bon.total;
            document.getElementById('paid').checked = bon.paid;

            // Load luggage items
            const firstItem = container.querySelector('.luggage-item');
            if (firstItem) {
                const luggage = bon.luggage;
                if (luggage && luggage.length > 0) {
                    firstItem.querySelector('.luggage-type').value = luggage[0].type;
                    firstItem.querySelector('.luggage-quantity').value = luggage[0].quantity;
                    
                    for (let i = 1; i < luggage.length; i++) {
                        this.addLuggageItem();
                        const newItem = container.lastChild;
                        newItem.querySelector('.luggage-type').value = luggage[i].type;
                        newItem.querySelector('.luggage-quantity').value = luggage[i].quantity;
                    }
                }
            }
        } else {
            // Creating new bon - generate new ID only once
            document.getElementById('bon-form-title').textContent = 'Nouveau Bon';
            if (document.getElementById('current-bon-id').textContent === 'En cours de génération...') {
                const newId = await this.generateId();
                document.getElementById('current-bon-id').textContent = newId;
                document.getElementById('bon-id').value = newId;
            }
        }

        // Update total colis
        this.updateTotalColis();
    }

    async loadHistory() {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?user_id=eq.${this.currentUser.id}&order=created_at.desc`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bons = await response.json();
                this.displayHistory(bons);
            }
        } catch (error) {
            console.error('Error loading history:', error);
        }
    }

    displayHistory(bons) {
        const tbody = document.getElementById('history-table-body');
        tbody.innerHTML = '';

        bons.forEach(bon => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${bon.id}</td>
                <td>${bon.sender_first_name} ${bon.sender_last_name}</td>
                <td>${bon.recipient_first_name} ${bon.recipient_last_name}</td>
                <td>${bon.origin}</td>
                <td>${bon.destination}</td>
                <td>${new Date(bon.created_at).toLocaleDateString()}</td>
                <td>${bon.total} €</td>
                <td>${bon.paid ? 'Oui' : 'Non'}</td>
                <td>
                    <button class="btn btn-secondary btn-small edit-btn" data-id="${bon.id}">Modifier</button>
                    <button class="btn btn-info btn-small share-btn" data-id="${bon.id}">Partager</button>
                    <button class="btn btn-success btn-small export-btn" data-id="${bon.id}">PDF</button>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Add event listeners to action buttons
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                this.editBon(id);
            });
        });

        document.querySelectorAll('.share-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                this.shareBon(id);
            });
        });

        document.querySelectorAll('.export-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                this.exportPDF(id);
            });
        });
    }

    async editBon(id) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=eq.${id}&user_id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bon = await response.json();
                this.navigateTo('new-bon');
                this.loadNewBon(bon[0]);
            }
        } catch (error) {
            console.error('Error loading bon for edit:', error);
        }
    }

    async shareBon(id) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=eq.${id}&user_id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bon = await response.json();
                
                // Create a temporary element to generate the content
                const tempDiv = document.createElement('div');
                tempDiv.style.display = 'none';
                tempDiv.innerHTML = `
                    <div style="padding: 20px; font-family: Arial, sans-serif;">
                        <h2>Bon d'expédition</h2>
                        <p><strong>ID:</strong> ${bon[0].id}</p>
                        <p><strong>Date:</strong> ${new Date(bon[0].created_at).toLocaleDateString()}</p>
                        <h3>Expéditeur:</h3>
                        <p>${bon[0].sender_first_name} ${bon[0].sender_last_name}</p>
                        <p>Téléphone: ${bon[0].sender_phone}</p>
                        <p>CIN: ${bon[0].sender_cin}</p>
                        <h3>Destinataire:</h3>
                        <p>${bon[0].recipient_first_name} ${bon[0].recipient_last_name}</p>
                        <p>Téléphone: ${bon[0].recipient_phone}</p>
                        <p>CIN: ${bon[0].recipient_cin}</p>
                        <h3>Itinéraire:</h3>
                        <p>${bon[0].origin} → ${bon[0].destination}</p>
                        <h3>Bagages:</h3>
                        ${bon[0].luggage.map(item => `<p>${item.type}: ${item.quantity}</p>`).join('')}
                        <p><strong>Total des colis:</strong> ${bon[0].luggage.reduce((total, item) => total + item.quantity, 0)}</p>
                        <p><strong>Total:</strong> ${bon[0].total} €</p>
                        <p><strong>Payé:</strong> ${bon[0].paid ? 'Oui' : 'Non'}</p>
                    </div>
                `;
                document.body.appendChild(tempDiv);
                
                const canvas = await html2canvas(tempDiv);
                const image = canvas.toDataURL('image/png');
                
                // Create blob from data URL
                const byteString = atob(image.split(',')[1]);
                const mimeString = image.split(',')[0].split(':')[1].split(';')[0];
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                    ia[i] = byteString.charCodeAt(i);
                }
                const blob = new Blob([ab], { type: mimeString });
                
                if (navigator.share) {
                    await navigator.share({
                        title: `Bon d'expédition ${bon[0].id}`,
                        text: `Bon d'expédition pour ${bon[0].recipient_first_name} ${bon[0].recipient_last_name}`,
                        files: [new File([blob], 'bon.png', { type: 'image/png' })]
                    });
                } else {
                    // Fallback: download image
                    const link = document.createElement('a');
                    link.href = image;
                    link.download = `bon_${id}.png`;
                    link.click();
                }
                
                // Clean up
                document.body.removeChild(tempDiv);
            }
        } catch (error) {
            console.error('Error sharing bon:', error);
        }
    }

    async exportPDF(id) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=eq.${id}&user_id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bon = await response.json();
                const { jsPDF } = window.jspdf;
                
                // Créer un nouveau document PDF (A4, portrait, en mm)
                const doc = new jsPDF({
                    orientation: 'portrait',
                    unit: 'mm',
                    format: 'a4'
                });
                
                // Définir la police et la couleur
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0); // Noir
                
                // En-tête
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(16);
                doc.text('IMENDI TRANS', 20, 20);
                
                // Numéro de bon et date (en haut à droite)
                doc.setFontSize(12);
                doc.text(`BON-${new Date().getFullYear()}-${bon[0].id.split('-')[2] || '0001'}`, 150, 20);
                doc.setFontSize(10);
                doc.text(`Date: ${new Date(bon[0].created_at).toLocaleDateString('fr-FR')}`, 150, 25);
                
                // Ligne horizontale sous l'en-tête
                doc.setDrawColor(30, 58, 138); // Bleu foncé
                doc.line(20, 30, 190, 30);
                
                // Section Expéditeur
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(30, 58, 138); // Bleu foncé
                doc.text('Expéditeur', 25, 40);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(0, 0, 0); // Noir
                doc.text(`Nom: ${bon[0].sender_first_name} ${bon[0].sender_last_name}`, 25, 45);
                doc.text(`Téléphone: ${bon[0].sender_phone}`, 25, 50);
                doc.text(`CIN: ${bon[0].sender_cin}`, 25, 55);
                
                // Section Destinataire
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(30, 58, 138); // Bleu foncé
                doc.text('Destinataire', 110, 40);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(0, 0, 0); // Noir
                doc.text(`Nom: ${bon[0].recipient_first_name} ${bon[0].recipient_last_name}`, 110, 45);
                doc.text(`Téléphone: ${bon[0].recipient_phone}`, 110, 50);
                doc.text(`CIN: ${bon[0].recipient_cin}`, 110, 55);
                
                // Trajet - CORRECTION : Utilisation de text avec échappement
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0); // Noir
                doc.text('Trajet:', 25, 65);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                
                // Nettoyage des données avant affichage
                const origin = bon[0].origin ? bon[0].origin.replace(/[^\w\s\-.,]/g, '') : '';
                const destination = bon[0].destination ? bon[0].destination.replace(/[^\w\s\-.,]/g, '') : '';
                const trajetText = `${origin} → ${destination}`;
                
                doc.text(trajetText, 45, 65);
                
                // Détails des bagages
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(30, 58, 138); // Bleu foncé
                doc.text('Détails des Bagages', 25, 75);
                
                // Tableau des bagages
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(0, 0, 0); // Noir
                doc.rect(25, 80, 80, 10); // Cellule Article
                doc.rect(105, 80, 80, 10); // Cellule Quantité
                doc.text('Article', 28, 86);
                doc.text('Quantité', 108, 86);
                
                // Données du tableau
                let yPos = 90;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(0, 0, 0); // Noir
                
                if (bon[0].luggage.length === 0) {
                    doc.rect(25, yPos, 80, 10);
                    doc.rect(105, yPos, 80, 10);
                    doc.text('Aucun article détaillé.', 28, yPos + 6);
                } else {
                    bon[0].luggage.forEach(item => {
                        doc.rect(25, yPos, 80, 10);
                        doc.rect(105, yPos, 80, 10);
                        
                        // Nettoyage des données avant affichage
                        const type = item.type ? item.type.replace(/[^\w\s\-.,]/g, '') : '';
                        const quantity = item.quantity ? item.quantity.toString() : '';
                        
                        doc.text(type, 28, yPos + 6);
                        doc.text(quantity, 108, yPos + 6);
                        yPos += 10;
                    });
                }
                
                // Statut et Total
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.text('Statut:', 25, yPos + 10);
                
                // Statut (Payé ou Non Payé)
                const statutText = bon[0].paid ? 'Payé' : 'Non Payé';
                if (bon[0].paid) {
                    doc.setTextColor(0, 153, 51); // Vert pour "Payé"
                } else {
                    doc.setTextColor(255, 0, 0); // Rouge pour "Non Payé"
                }
                doc.text(statutText, 45, yPos + 10);
                
                // Total
                doc.setTextColor(0, 0, 0); // Retour au noir
                doc.setFontSize(10);
                doc.text(`Total: ${bon[0].total.toFixed(2)} €`, 150, yPos + 10);
                
                // Sauvegarder le PDF
                doc.save(`bon_${id}.pdf`);
            }
        } catch (error) {
            console.error('Error exporting PDF:', error);
            this.showMessage('Erreur lors de la génération du PDF', 'error');
        }
    }

    async loadStatistics(startDate = null, endDate = null) {
        try {
            const token = localStorage.getItem('access_token');
            let url = `${SUPABASE_URL}/rest/v1/bons?user_id=eq.${this.currentUser.id}`;
            
            if (startDate && endDate) {
                url += `&created_at=gte.${startDate}T00:00:00&created_at=lte.${endDate}T23:59:59`;
            }

            const response = await fetch(url, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bons = await response.json();
                
                let totalRevenue = 0;
                let paidAmount = 0;
                let unpaidAmount = 0;
                let paidCount = 0;
                let unpaidCount = 0;

                bons.forEach(bon => {
                    totalRevenue += parseFloat(bon.total) || 0;
                    if (bon.paid) {
                        paidAmount += parseFloat(bon.total) || 0;
                        paidCount++;
                    } else {
                        unpaidAmount += parseFloat(bon.total) || 0;
                        unpaidCount++;
                    }
                });

                document.getElementById('total-revenue').textContent = `${totalRevenue.toFixed(2)} €`;
                document.getElementById('paid-amount').textContent = `${paidAmount.toFixed(2)} €`;
                document.getElementById('paid-count').textContent = `${paidCount} bons`;
                document.getElementById('unpaid-amount').textContent = `${unpaidAmount.toFixed(2)} €`;
                document.getElementById('unpaid-count').textContent = `${unpaidCount} bons`;
            }
        } catch (error) {
            console.error('Error loading statistics:', error);
        }
    }

    loadSettings() {
        document.getElementById('start-number-setting').value = this.startNumber;
        this.loadUsernameFromProfile();
    }

    async loadUsernameFromProfile() {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const profiles = await response.json();
                if (profiles.length > 0) {
                    document.getElementById('username-setting').value = profiles[0].username || '';
                }
            }
        } catch (error) {
            console.error('Error loading username:', error);
        }
    }

    async getUsernameFromProfile() {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const profiles = await response.json();
                if (profiles.length > 0) {
                    return profiles[0].username;
                }
            }
        } catch (error) {
            console.error('Error getting username:', error);
        }
        return null;
    }

    saveSettings() {
        const startNumber = parseInt(document.getElementById('start-number-setting').value);
        if (startNumber >= 1) {
            this.startNumber = startNumber;
            localStorage.setItem('startNumber', startNumber.toString());
            
            // Mettre à jour le numéro de bon dans la page "Nouveau Bon" si elle est active
            if (this.currentView === 'new-bon') {
                this.updateBonNumber();
            }
            
            this.showMessage('Paramètres sauvegardés', 'success');
        } else {
            this.showMessage('Numéro de départ invalide', 'error');
        }
    }

    async updateBonNumber() {
        // Generate a new ID with the updated start number
        const newId = await this.generateId();
        document.getElementById('current-bon-id').textContent = newId;
        document.getElementById('bon-id').value = newId;
    }

    async saveUsername() {
        const username = document.getElementById('username-setting').value.trim();
        if (username) {
            try {
                const token = localStorage.getItem('access_token');
                
                // Check if profile exists
                const checkResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}`, {
                    headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (checkResponse.ok) {
                    const profiles = await checkResponse.json();
                    
                    if (profiles.length > 0) {
                        // Update existing profile
                        const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}`, {
                            method: 'PATCH',
                            headers: {
                                'Content-Type': 'application/json',
                                'apikey': SUPABASE_ANON_KEY,
                                'Authorization': `Bearer ${token}`,
                                'Prefer': 'return=representation'
                            },
                            body: JSON.stringify({ username: username })
                        });

                        if (updateResponse.ok) {
                            // Update current user data
                            // Update dashboard username
                            document.getElementById('user-name').textContent = username;
                            this.showMessage('Nom d\'utilisateur sauvegardé', 'success');
                        } else {
                            this.showMessage('Erreur lors de la sauvegarde', 'error');
                        }
                    } else {
                        // Create new profile
                        const createResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'apikey': SUPABASE_ANON_KEY,
                                'Authorization': `Bearer ${token}`,
                                'Prefer': 'return=representation'
                            },
                            body: JSON.stringify({ 
                                id: this.currentUser.id,
                                username: username,
                                full_name: username
                            })
                        });

                        if (createResponse.ok) {
                            // Update dashboard username
                            document.getElementById('user-name').textContent = username;
                            this.showMessage('Nom d\'utilisateur sauvegardé', 'success');
                        } else {
                            this.showMessage('Erreur lors de la sauvegarde', 'error');
                        }
                    }
                }
            } catch (error) {
                console.error('Error updating username:', error);
                this.showMessage('Erreur de connexion', 'error');
            }
        } else {
            this.showMessage('Veuillez entrer un nom d\'utilisateur valide', 'error');
        }
    }

    searchBons(query) {
        if (!query.trim()) {
            this.loadHistory();
            return;
        }

        // This would be implemented with a more complex search in a real app
        // For now, we'll just filter the existing history
        const rows = document.querySelectorAll('#history-table-body tr');
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            if (text.includes(query.toLowerCase())) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    handleOnline() {
        this.offlineMode = false;
        this.updateOfflineBanner();
        
        // Try to sync offline data
        this.syncOfflineData();
    }

    handleOffline() {
        this.offlineMode = true;
        this.updateOfflineBanner();
    }

    updateOfflineBanner() {
        const banner = document.getElementById('offline-banner');
        if (this.offlineMode) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }

    async syncOfflineData() {
        if ('serviceWorker' in navigator && 'sync' in navigator.serviceWorker) {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register('sync-bons');
        }
    }

    showMessage(message, type = 'info') {
        // Create a temporary message element
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        messageEl.textContent = message;
        messageEl.style.position = 'fixed';
        messageEl.style.top = '20px';
        messageEl.style.right = '20px';
        messageEl.style.padding = '10px 20px';
        messageEl.style.borderRadius = '4px';
        messageEl.style.zIndex = '1000';
        
        switch (type) {
            case 'success':
                messageEl.style.backgroundColor = '#d4edda';
                messageEl.style.color = '#155724';
                break;
            case 'error':
                messageEl.style.backgroundColor = '#f8d7da';
                messageEl.style.color = '#721c24';
                break;
            case 'warning':
                messageEl.style.backgroundColor = '#fff3cd';
                messageEl.style.color = '#856404';
                break;
            default:
                messageEl.style.backgroundColor = '#d1ecf1';
                messageEl.style.color = '#0c5460';
        }

        document.body.appendChild(messageEl);
        
        setTimeout(() => {
            messageEl.remove();
        }, 3000);
    }

    // Fonctions de débogage
    async debugNetwork() {
        const output = document.getElementById('debug-output');
        output.textContent = 'Test de connexion en cours...\n';
        
        try {
            const startTime = Date.now();
            const response = await fetch('https://httpbin.org/get');
            const endTime = Date.now();
            
            output.textContent += `Connexion HTTP réussie: ${response.ok}\n`;
            output.textContent += `Temps de réponse: ${endTime - startTime}ms\n`;
            output.textContent += `Statut: ${response.status}\n`;
        } catch (error) {
            output.textContent += `Erreur de connexion: ${error.message}\n`;
        }
    }

    async debugDatabase() {
        const output = document.getElementById('debug-output');
        output.textContent = 'Test de la base de données...\n';
        
        try {
            if (this.db) {
                const transaction = this.db.transaction(['sync-queue'], 'readonly');
                const store = transaction.objectStore('sync-queue');
                const count = await store.count();
                output.textContent += `Base de données prête: ${count} éléments en attente\n`;
            } else {
                output.textContent += 'Base de données non initialisée\n';
            }
        } catch (error) {
            output.textContent += `Erreur de base de données: ${error.message}\n`;
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new IMENDITransApp();
});

// Prevent page refresh from logging out user
window.addEventListener('beforeunload', (e) => {
    // Save current view
    localStorage.setItem('currentView', document.querySelector('.page:not(.hidden)').id);
});

// On page load, restore the view
window.addEventListener('load', () => {
    const savedView = localStorage.getItem('currentView');
    if (savedView && document.getElementById(savedView)) {
        document.getElementById(savedView).classList.remove('hidden');
    }
});