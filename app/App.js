import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

const ALL_DEITIES = [
  'Aker', 'Amun', 'Anubis', 'Apis', 'Aten', 'Atum', 'Bennu', 'Bes',
  'Geb', 'Heru-ur', 'Horus', 'Imhotep', 'Khepri', 'Khnum', 'Khonsu',
  'Maahes', 'Min', 'Montu', 'Nefertem', 'Onuris', 'Osiris', 'Ptah',
  'Ra', 'Set',
];

const DEFAULT_SELECTED = ['Ra', 'Anubis', 'Horus', 'Osiris', 'Ptah', 'Set'];

export default function App() {
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [topic, setTopic] = useState('What does it mean to be remembered after death?');
  const [turns, setTurns] = useState('8');
  const [selected, setSelected] = useState(new Set(DEFAULT_SELECTED));
  const [transcript, setTranscript] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const toggleDeity = (name) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  const startChat = async () => {
    setError(null);
    setTranscript([]);
    if (selected.size === 0) {
      setError('Pick at least one deity.');
      return;
    }
    if (!topic.trim()) {
      setError('Enter a topic.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          deities: Array.from(selected),
          turns: Number(turns) || 8,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);
      setTranscript(body.transcript || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Deity Chat</Text>

        <Text style={styles.label}>Server URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://localhost:3000"
        />

        <Text style={styles.label}>Topic</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={topic}
          onChangeText={setTopic}
          multiline
          placeholder="What shall the gods discuss?"
        />

        <Text style={styles.label}>Turns</Text>
        <TextInput
          style={styles.input}
          value={turns}
          onChangeText={setTurns}
          keyboardType="numeric"
        />

        <Text style={styles.label}>Deities ({selected.size} selected)</Text>
        <View style={styles.chipRow}>
          {ALL_DEITIES.map((name) => {
            const on = selected.has(name);
            return (
              <Pressable
                key={name}
                onPress={() => toggleDeity(name)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{name}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={startChat}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? 'Generating…' : 'Begin Chat'}</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}
        {loading && <ActivityIndicator style={{ marginTop: 16 }} />}

        {transcript.length > 0 && (
          <View style={styles.transcript}>
            {transcript.map((t, idx) => (
              <View key={idx} style={styles.bubble}>
                <Text style={styles.bubbleName}>{t.deity}</Text>
                <Text style={styles.bubbleText}>{t.text}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f1ea' },
  scroll: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 20, color: '#2a2a2a' },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 6,
    color: '#555',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d6d2c8',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fff',
    color: '#222',
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d6d2c8',
    backgroundColor: '#fff',
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: { backgroundColor: '#3a3a3a', borderColor: '#3a3a3a' },
  chipText: { color: '#333' },
  chipTextOn: { color: '#fff' },
  button: {
    backgroundColor: '#3a3a3a',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#b00020', marginTop: 12 },
  transcript: { marginTop: 28 },
  bubble: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e3dfd6',
  },
  bubbleName: { fontWeight: '700', marginBottom: 4, color: '#7a4a1c' },
  bubbleText: { lineHeight: 20, color: '#333' },
});
