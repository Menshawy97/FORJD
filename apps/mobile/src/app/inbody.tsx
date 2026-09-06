import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { BodyScanSummary } from '@forjd/contracts';

import { extractBodyScan, listBodyScans } from '@/auth/apiClient';
import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { formatScanDate } from '@/features/body/format-scan-date';
import { setPendingScan } from '@/store/pending-scan';
import { colors } from '@/theme/tokens';

const CAMERA_PERMISSION_MESSAGE = 'Camera access is needed to photograph your InBody sheet.';

/**
 * `s_inbody()` (`FORJD Mobile.dc.html:2248`), matched against
 * `screenshots/inbody update and history.png`. The drop-zone's diagonal striped background
 * (`repeating-linear-gradient(135deg,#141517 0 10px,#17181a 10px 20px)`) is approximated as a
 * flat `#161719` -- RN has no CSS-gradient primitive without an extra native dependency, and
 * a texture-only visual is not worth one for a rarely-visited screen. Everything else --
 * dimensions, colors, typography, spacing -- is transcribed exactly.
 *
 * The caption reads "jpg, png" (the design's copy says "jpg, png, pdf"): `sharp`, the
 * server's mandatory re-encoder (ADR-024), does not decode PDF, so advertising a format that
 * would fail is worse than a caption one word shorter than the design's.
 */
export default function InBodyScreen() {
  const [scans, setScans] = useState<BodyScanSummary[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const toast = useToast();
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = (loadGeneration.current += 1);
    try {
      const response = await listBodyScans();
      if (generation === loadGeneration.current) setScans(response.scans);
    } catch {
      if (generation === loadGeneration.current) setScans([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        loadGeneration.current += 1;
      };
    }, [load]),
  );

  const runExtraction = async (photoUri: string) => {
    setExtracting(true);
    try {
      const extracted = await extractBodyScan(photoUri);
      setPendingScan({ photoUri, extracted });
      router.push('/inbody-confirm');
    } catch {
      toast.show('Could not read that photo. Try again with better lighting.');
    } finally {
      setExtracting(false);
    }
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
    if (result.canceled || result.assets.length === 0) return;
    await runExtraction(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      toast.show(CAMERA_PERMISSION_MESSAGE);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (result.canceled || result.assets.length === 0) return;
    await runExtraction(result.assets[0].uri);
  };

  const toggleSelection = (scanId: string) => {
    setCompareSelection((current) => {
      if (current.includes(scanId)) return current.filter((id) => id !== scanId);
      if (current.length >= 2) return [current[1], scanId];
      return [...current, scanId];
    });
  };

  return (
    <ScreenBackground>
      <Header title="InBody Scan" onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <Text style={{ margin: 0, marginBottom: 18, fontFamily: 'Archivo', fontSize: 13.5, lineHeight: 13.5 * 1.5, color: colors.dim }}>
          Photograph your printed result sheet. Values are extracted automatically — you
          confirm them before anything is saved.
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo or upload InBody result sheet"
          onPress={takePhoto}
          disabled={extracting}
          style={{
            height: 210,
            borderRadius: 16,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: 'rgba(255,255,255,.16)',
            backgroundColor: '#161719',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 13,
          }}>
          {extracting ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Icon name="upload" color="#8b8b83" size={26} />
              <Text style={{ fontFamily: 'Archivo', fontSize: 13.5, fontWeight: '600', color: colors.text }}>
                Take photo or upload
              </Text>
              <Text
                style={{
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  color: '#5c5c55',
                }}>
                inbody result sheet · jpg, png
              </Text>
            </>
          )}
        </Pressable>

        <Pressable accessibilityRole="button" onPress={pickFromLibrary} style={{ marginTop: 10, alignSelf: 'center' }}>
          <Text style={{ fontFamily: 'Archivo', fontSize: 12, color: colors.accent }}>
            Choose from library instead
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 24, marginBottom: 2 }}>
          <Text
            style={{
              fontFamily: 'Archivo',
              fontSize: 9.5,
              fontWeight: '600',
              letterSpacing: 0.1 * 9.5,
              textTransform: 'uppercase',
              color: '#77776f',
            }}>
            Scan history
          </Text>
          {scans.length >= 2 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setCompareMode((v) => !v);
                setCompareSelection([]);
              }}>
              <Text style={{ fontFamily: 'Archivo', fontSize: 11.5, fontWeight: '600', color: colors.accent }}>
                {compareMode ? 'Cancel' : 'Compare'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {scans.length === 0 ? (
          <Text style={{ fontFamily: 'Archivo', fontSize: 12.5, color: colors.dim, paddingVertical: 13 }}>
            No scans yet. Your first confirmed scan will appear here.
          </Text>
        ) : (
          scans.map((scan) => {
            const selected = compareSelection.includes(scan.id);
            return (
              <Pressable
                key={scan.id}
                accessibilityRole="button"
                onPress={
                  compareMode
                    ? () => toggleSelection(scan.id)
                    : () => router.push({ pathname: '/scan/[id]', params: { id: scan.id } })
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 13,
                  borderBottomWidth: 1,
                  borderBottomColor: 'rgba(255,255,255,.05)',
                }}>
                {compareMode ? (
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: selected ? 0 : 1.5,
                      borderColor: '#37383c',
                      backgroundColor: selected ? colors.accent : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    {selected ? <Icon name="check" color="#fff" size={13} /> : null}
                  </View>
                ) : (
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      backgroundColor: '#1c1d20',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Icon name="scale" color="#8b8b83" size={18} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Archivo', fontSize: 13.5, fontWeight: '600', color: colors.text }}>
                    {formatScanDate(scan.measuredAt)}
                  </Text>
                  <Text
                    style={{
                      marginTop: 5,
                      fontFamily: 'Archivo',
                      fontSize: 11.5,
                      color: colors.dim,
                      fontVariant: ['tabular-nums'],
                    }}>
                    {scan.weightKg != null ? `${scan.weightKg} kg` : '—'}
                    {scan.bodyFatPercent != null ? ` · ${scan.bodyFatPercent}%` : ''}
                  </Text>
                </View>
                {compareMode ? null : <Icon name="chevron" color="#8b8b83" size={17} />}
              </Pressable>
            );
          })
        )}

        {compareSelection.length === 2 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/inbody-compare',
                params: { a: compareSelection[0], b: compareSelection[1] },
              })
            }
            style={{
              marginTop: 16,
              height: 52,
              borderRadius: 12,
              backgroundColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text style={{ fontFamily: 'Archivo', fontSize: 14, fontWeight: '700', color: '#101011' }}>
              Compare Selected Scans
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <Toast {...toast} />
    </ScreenBackground>
  );
}
