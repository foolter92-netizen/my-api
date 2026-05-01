'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Zap, Users, Server, Key, BarChart3, Plus, Trash2, ArrowLeft,
  Activity, DollarSign, Cpu, Shield, Pencil, X, Check
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [providerKeys, setProviderKeys] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const [newProvider, setNewProvider] = useState({ name: '', baseUrl: '', priority: '1', loadBalance: 'round_robin', chatPath: '/chat/completions', authType: 'bearer', responseFormat: 'openai' });
  const [newKey, setNewKey] = useState({ providerId: '', key: '', name: '', weight: '1' });
  const [newModel, setNewModel] = useState({
    providerId: '', name: '', displayName: '', inputPrice: '0', outputPrice: '0', maxTokens: '4096'
  });
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    displayName: '', inputPrice: '0', outputPrice: '0', maxTokens: '4096', status: 'active'
  });

  const loadAdminData = useCallback(async () => {
    try {
      const [statsRes, providersRes, keysRes, modelsRes, usersRes] = await Promise.all([
        apiFetch('/api/admin/stats'),
        apiFetch('/api/admin/providers'),
        apiFetch('/api/admin/provider-keys'),
        apiFetch('/api/admin/models'),
        apiFetch('/api/admin/users'),
      ]);

      if (statsRes.ok) setStats((await statsRes.json()).data);
      if (providersRes.ok) setProviders((await providersRes.json()).data || []);
      if (keysRes.ok) setProviderKeys((await keysRes.json()).data || []);
      if (modelsRes.ok) setModels((await modelsRes.json()).data || []);
      if (usersRes.ok) setUsers((await usersRes.json()).data || []);
    } catch (error) {
      console.error('Failed to load admin data:', error);
    }
  }, []);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'admin') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAdminData();
    }
  }, [user, activeTab, loadAdminData]);

  const createProvider = async () => {
    await apiFetch('/api/admin/providers', {
      method: 'POST',
      body: JSON.stringify({
        name: newProvider.name,
        baseUrl: newProvider.baseUrl,
        priority: parseInt(newProvider.priority),
        loadBalance: newProvider.loadBalance,
        chatPath: newProvider.chatPath,
        authType: newProvider.authType,
        responseFormat: newProvider.responseFormat,
      }),
    });
    setNewProvider({ name: '', baseUrl: '', priority: '1', loadBalance: 'round_robin', chatPath: '/chat/completions', authType: 'bearer', responseFormat: 'openai' });
    loadAdminData();
  };

  const createProviderKey = async () => {
    await apiFetch('/api/admin/provider-keys', {
      method: 'POST',
      body: JSON.stringify({
        providerId: newKey.providerId,
        key: newKey.key,
        name: newKey.name,
        weight: parseInt(newKey.weight),
      }),
    });
    setNewKey({ providerId: '', key: '', name: '', weight: '1' });
    loadAdminData();
  };

  const createModel = async () => {
    await apiFetch('/api/admin/models', {
      method: 'POST',
      body: JSON.stringify({
        providerId: newModel.providerId,
        name: newModel.name,
        displayName: newModel.displayName,
        inputPricePer1m: parseFloat(newModel.inputPrice),
        outputPricePer1m: parseFloat(newModel.outputPrice),
        maxTokens: parseInt(newModel.maxTokens),
      }),
    });
    setNewModel({ providerId: '', name: '', displayName: '', inputPrice: '0', outputPrice: '0', maxTokens: '4096' });
    loadAdminData();
  };

  const deleteProvider = async (id: string) => {
    if (!confirm('Delete this provider and all its keys/models?')) return;
    await apiFetch(`/api/admin/providers?id=${id}`, { method: 'DELETE' });
    loadAdminData();
  };

  const deleteProviderKey = async (id: string) => {
    await apiFetch(`/api/admin/provider-keys?id=${id}`, { method: 'DELETE' });
    loadAdminData();
  };

  const startEditModel = (model: any) => {
    setEditingModel(model.id);
    setEditForm({
      displayName: model.display_name,
      inputPrice: String(model.input_price_per_1m),
      outputPrice: String(model.output_price_per_1m),
      maxTokens: String(model.max_tokens),
      status: model.status,
    });
  };

  const saveEditModel = async (id: string) => {
    try {
      const res = await apiFetch('/api/admin/models', {
        method: 'PUT',
        body: JSON.stringify({
          id,
          displayName: editForm.displayName,
          inputPricePer1m: parseFloat(editForm.inputPrice) || 0,
          outputPricePer1m: parseFloat(editForm.outputPrice) || 0,
          maxTokens: parseInt(editForm.maxTokens) || 4096,
          status: editForm.status,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert('Failed to save: ' + (data.error || 'Unknown error'));
        return;
      }
      setEditingModel(null);
      loadAdminData();
    } catch (error: any) {
      alert('Error saving model: ' + error.message);
    }
  };

  const cancelEditModel = () => {
    setEditingModel(null);
  };

  const deleteModel = async (id: string) => {
    await apiFetch(`/api/admin/models?id=${id}`, { method: 'DELETE' });
    loadAdminData();
  };

  const updateUser = async (id: string, field: string, value: any) => {
    await apiFetch('/api/admin/users', {
      method: 'PUT',
      body: JSON.stringify({ id, [field]: value }),
    });
    loadAdminData();
  };

  if (loading || !user || user.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <nav className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
              </Button>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                <span className="font-bold">Admin Panel</span>
              </div>
            </div>
            <Badge variant="destructive">Admin Access</Badge>
          </div>
        </div>
      </nav>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-56 border-r border-border/40 min-h-[calc(100vh-56px)] p-4 hidden md:block">
          <nav className="space-y-1">
            {[
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'providers', label: 'Providers', icon: Server },
              { id: 'keys', label: 'Provider Keys', icon: Key },
              { id: 'models', label: 'Models', icon: Cpu },
              { id: 'users', label: 'Users', icon: Users },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 max-w-6xl">
          {/* Mobile tabs */}
          <div className="flex gap-2 mb-6 md:hidden overflow-x-auto">
            {['overview', 'providers', 'keys', 'models', 'users'].map(tab => (
              <Button
                key={tab}
                variant={activeTab === tab ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab(tab)}
                className="capitalize"
              >
                {tab}
              </Button>
            ))}
          </div>

          {/* Overview */}
          {activeTab === 'overview' && stats && (
            <div className="space-y-6">
              <h1 className="text-2xl font-bold">System Overview</h1>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" />
                      <span className="text-sm text-muted-foreground">Total Users</span>
                    </div>
                    <p className="text-2xl font-bold mt-1">{stats.totalUsers}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-primary" />
                      <span className="text-sm text-muted-foreground">Daily Requests</span>
                    </div>
                    <p className="text-2xl font-bold mt-1">{stats.dailyRequests?.toLocaleString() || 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-primary" />
                      <span className="text-sm text-muted-foreground">Total Revenue</span>
                    </div>
                    <p className="text-2xl font-bold mt-1">${stats.totalRevenue?.toFixed(2) || '0.00'}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-primary" />
                      <span className="text-sm text-muted-foreground">Active Providers</span>
                    </div>
                    <p className="text-2xl font-bold mt-1">{stats.activeProviders}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Provider Keys Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {providers.map(p => (
                        <div key={p.id} className="flex items-center justify-between py-1">
                          <span className="text-sm">{p.name}</span>
                          <Badge variant="secondary">{p.key_count} keys, {p.model_count} models</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Daily Stats</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between"><span className="text-sm text-muted-foreground">Tokens</span><span className="font-mono">{stats.dailyTokens?.toLocaleString() || 0}</span></div>
                      <div className="flex justify-between"><span className="text-sm text-muted-foreground">Cost</span><span className="font-mono">${stats.dailyCost?.toFixed(4) || '0.00'}</span></div>
                      <div className="flex justify-between"><span className="text-sm text-muted-foreground">User Balance</span><span className="font-mono">${stats.totalBalance?.toFixed(2) || '0.00'}</span></div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Providers */}
          {activeTab === 'providers' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold">Providers</h1>
                <p className="text-muted-foreground">Manage AI model providers</p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Add Provider</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <Input placeholder="Provider Name" value={newProvider.name} onChange={e => setNewProvider(p => ({ ...p, name: e.target.value }))} />
                    <Input placeholder="Base URL (e.g., https://api.example.com/v1)" value={newProvider.baseUrl} onChange={e => setNewProvider(p => ({ ...p, baseUrl: e.target.value }))} />
                    <Input placeholder="Chat Path (default: /chat/completions)" value={newProvider.chatPath} onChange={e => setNewProvider(p => ({ ...p, chatPath: e.target.value }))} />
                    <Select value={newProvider.authType} onValueChange={v => setNewProvider(p => ({ ...p, authType: v }))}>
                      <SelectTrigger><SelectValue placeholder="Auth Type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bearer">Bearer Token</SelectItem>
                        <SelectItem value="api_key">x-api-key Header</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={newProvider.responseFormat} onValueChange={v => setNewProvider(p => ({ ...p, responseFormat: v }))}>
                      <SelectTrigger><SelectValue placeholder="Response Format" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI Format</SelectItem>
                        <SelectItem value="yepapi">YepAPI Format</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={newProvider.loadBalance} onValueChange={v => setNewProvider(p => ({ ...p, loadBalance: v }))}>
                      <SelectTrigger><SelectValue placeholder="Load Balance" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="round_robin">Round Robin</SelectItem>
                        <SelectItem value="least_used">Least Used</SelectItem>
                        <SelectItem value="random_weighted">Random Weighted</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={createProvider} className="mt-3" disabled={!newProvider.name || !newProvider.baseUrl}>
                    <Plus className="h-4 w-4 mr-1" /> Add Provider
                  </Button>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {providers.map(provider => (
                  <Card key={provider.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{provider.name}</span>
                            <Badge variant={provider.status === 'active' ? 'default' : 'destructive'}>{provider.status}</Badge>
                            <Badge variant="outline">Priority: {provider.priority}</Badge>
                            <Badge variant="outline">{provider.load_balance}</Badge>
                          </div>
                          <p className="text-sm font-mono text-muted-foreground mt-1">{provider.base_url}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {provider.key_count} keys | {provider.model_count} models | Failover: {provider.failover_enabled ? 'On' : 'Off'}
                          </p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            <Badge variant="outline" className="text-xs">Path: {provider.chat_path || '/chat/completions'}</Badge>
                            <Badge variant="outline" className="text-xs">Auth: {provider.auth_type || 'bearer'}</Badge>
                            <Badge variant="outline" className="text-xs">Format: {provider.response_format || 'openai'}</Badge>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="text-red-500" onClick={() => deleteProvider(provider.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Provider Keys */}
          {activeTab === 'keys' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold">Provider Keys</h1>
                <p className="text-muted-foreground">Manage the key pool for providers</p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Add Provider Key</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <Select value={newKey.providerId} onValueChange={v => setNewKey(k => ({ ...k, providerId: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select Provider" /></SelectTrigger>
                      <SelectContent>
                        {providers.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input placeholder="API Key" value={newKey.key} onChange={e => setNewKey(k => ({ ...k, key: e.target.value }))} />
                    <Input placeholder="Key Name" value={newKey.name} onChange={e => setNewKey(k => ({ ...k, name: e.target.value }))} />
                    <Input placeholder="Weight" type="number" value={newKey.weight} onChange={e => setNewKey(k => ({ ...k, weight: e.target.value }))} />
                    <Button onClick={createProviderKey} disabled={!newKey.providerId || !newKey.key}>
                      <Plus className="h-4 w-4 mr-1" /> Add Key
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="max-h-[500px] overflow-y-auto space-y-2">
                    {providerKeys.map(pk => (
                      <div key={pk.id} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{pk.provider_name}</Badge>
                            <span className="text-sm font-medium">{pk.name}</span>
                            <Badge variant={
                              pk.status === 'active' ? 'default' :
                              pk.status === 'rate_limited' ? 'destructive' :
                              'secondary'
                            }>
                              {pk.status}
                            </Badge>
                          </div>
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">
                            {pk.key.substring(0, 8)}...{pk.key.substring(pk.key.length - 4)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{pk.usage_count} uses</span>
                          <span className="text-xs text-muted-foreground">Daily: {pk.daily_usage_count}</span>
                          <Button variant="ghost" size="sm" className="text-red-500 h-6 w-6 p-0" onClick={() => deleteProviderKey(pk.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {providerKeys.length === 0 && (
                      <p className="text-center text-muted-foreground py-4">No provider keys yet</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Models */}
          {activeTab === 'models' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold">Models</h1>
                <p className="text-muted-foreground">Manage available AI models</p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Add Model</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <Select value={newModel.providerId} onValueChange={v => setNewModel(m => ({ ...m, providerId: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select Provider" /></SelectTrigger>
                      <SelectContent>
                        {providers.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input placeholder="Model Name (e.g., deepseek-ai/deepseek-v3.1)" value={newModel.name} onChange={e => setNewModel(m => ({ ...m, name: e.target.value }))} />
                    <Input placeholder="Display Name" value={newModel.displayName} onChange={e => setNewModel(m => ({ ...m, displayName: e.target.value }))} />
                    <Input placeholder="Input Price per 1M tokens" type="number" step="0.01" value={newModel.inputPrice} onChange={e => setNewModel(m => ({ ...m, inputPrice: e.target.value }))} />
                    <Input placeholder="Output Price per 1M tokens" type="number" step="0.01" value={newModel.outputPrice} onChange={e => setNewModel(m => ({ ...m, outputPrice: e.target.value }))} />
                    <Input placeholder="Max Tokens" type="number" value={newModel.maxTokens} onChange={e => setNewModel(m => ({ ...m, maxTokens: e.target.value }))} />
                  </div>
                  <Button onClick={createModel} className="mt-3" disabled={!newModel.providerId || !newModel.name || !newModel.displayName}>
                    <Plus className="h-4 w-4 mr-1" /> Add Model
                  </Button>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {models.map(model => (
                  <Card key={model.id}>
                    <CardContent className="pt-6">
                      {editingModel === model.id ? (
                        /* Edit Mode */
                        <div className="space-y-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-primary">Editing: {model.name}</span>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" className="text-green-600 h-7 w-7 p-0" onClick={() => saveEditModel(model.id)}>
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" className="text-muted-foreground h-7 w-7 p-0" onClick={cancelEditModel}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            <Input placeholder="Display Name" value={editForm.displayName} onChange={e => setEditForm(f => ({ ...f, displayName: e.target.value }))} />
                            <Input placeholder="Input Price / 1M" type="number" step="0.01" value={editForm.inputPrice} onChange={e => setEditForm(f => ({ ...f, inputPrice: e.target.value }))} />
                            <Input placeholder="Output Price / 1M" type="number" step="0.01" value={editForm.outputPrice} onChange={e => setEditForm(f => ({ ...f, outputPrice: e.target.value }))} />
                            <Input placeholder="Max Tokens" type="number" value={editForm.maxTokens} onChange={e => setEditForm(f => ({ ...f, maxTokens: e.target.value }))} />
                            <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="inactive">Inactive</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      ) : (
                        /* View Mode */
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{model.display_name}</span>
                              <Badge variant="secondary">{model.provider_name}</Badge>
                              <Badge variant={model.status === 'active' ? 'default' : 'destructive'}>{model.status}</Badge>
                            </div>
                            <p className="text-sm font-mono text-muted-foreground">{model.name}</p>
                            <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
                              <span>In: ${model.input_price_per_1m}/1M</span>
                              <span>Out: ${model.output_price_per_1m}/1M</span>
                              <span>Max: {model.max_tokens?.toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="text-blue-500" onClick={() => startEditModel(model)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-500" onClick={() => deleteModel(model.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Users */}
          {activeTab === 'users' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold">Users</h1>
                <p className="text-muted-foreground">Manage platform users</p>
              </div>

              <Card>
                <CardContent className="pt-6">
                  <div className="max-h-[600px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/40">
                          <th className="text-left py-2 px-2">Email</th>
                          <th className="text-left py-2 px-2">Name</th>
                          <th className="text-left py-2 px-2">Role</th>
                          <th className="text-left py-2 px-2">Balance</th>
                          <th className="text-left py-2 px-2">Status</th>
                          <th className="text-left py-2 px-2">Usage</th>
                          <th className="text-left py-2 px-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u.id} className="border-b border-border/20">
                            <td className="py-2 px-2 font-mono text-xs">{u.email}</td>
                            <td className="py-2 px-2">{u.name}</td>
                            <td className="py-2 px-2">
                              <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role}</Badge>
                            </td>
                            <td className="py-2 px-2 font-mono">${Number(u.balance).toFixed(2)}</td>
                            <td className="py-2 px-2">
                              <Badge variant={u.status === 'active' ? 'default' : 'destructive'}>{u.status}</Badge>
                            </td>
                            <td className="py-2 px-2 font-mono">${Number(u.total_usage || 0).toFixed(4)}</td>
                            <td className="py-2 px-2">
                              <div className="flex gap-1">
                                {u.status === 'active' ? (
                                  <Button variant="ghost" size="sm" className="text-orange-500 h-7 text-xs" onClick={() => updateUser(u.id, 'status', 'suspended')}>
                                    Suspend
                                  </Button>
                                ) : (
                                  <Button variant="ghost" size="sm" className="text-green-500 h-7 text-xs" onClick={() => updateUser(u.id, 'status', 'active')}>
                                    Activate
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
