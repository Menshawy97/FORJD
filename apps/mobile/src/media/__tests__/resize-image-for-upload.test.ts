// The real API is a named `ImageManipulator` object, not a free `manipulate` export -- see
// `resize-image-for-upload.ts`'s own comment on why (confirmed against the installed
// `expo-image-manipulator@14.0.8` type declarations, SDK 54).
//
// The mock is built entirely inside the factory rather than referencing outer `mock`-prefixed
// consts: Jest's hoisting plugin permits that reference syntactically, but (per Jest's own
// docs) does not guarantee the const is initialized before the factory runs, and in practice
// here it wasn't -- `ImageManipulator.manipulate` came back `undefined`. Pulling the same
// `jest.fn()` back out via the mocked import below is the guaranteed-safe pattern.
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { WEBP: 'webp', JPEG: 'jpeg', PNG: 'png' },
}));

import { ImageManipulator } from 'expo-image-manipulator';
import { resizeImageForUpload } from '../resize-image-for-upload';

const mockManipulate = ImageManipulator.manipulate as jest.Mock;

describe('resizeImageForUpload', () => {
  const mockSaveAsync = jest.fn();
  const mockRenderAsync = jest.fn();
  const mockResize = jest.fn();
  const mockManipulationContext = { resize: mockResize, renderAsync: mockRenderAsync };

  beforeEach(() => {
    jest.clearAllMocks();
    mockManipulate.mockReturnValue(mockManipulationContext);
    mockResize.mockReturnValue(mockManipulationContext);
    mockRenderAsync.mockResolvedValue({ saveAsync: mockSaveAsync });
  });

  it('resizes an oversized image to fit within maxDimension, preserving aspect ratio, and re-encodes to WebP', async () => {
    mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/resized.webp', width: 512, height: 384 });

    const result = await resizeImageForUpload(
      'file:///tmp/photo.jpg',
      { width: 4000, height: 3000 },
      512,
    );

    expect(mockManipulate).toHaveBeenCalledWith('file:///tmp/photo.jpg');
    expect(mockResize).toHaveBeenCalledWith({ width: 512, height: 384 });
    expect(mockSaveAsync).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'webp', compress: 0.8 }),
    );
    expect(result).toEqual({ uri: 'file:///tmp/resized.webp', width: 512, height: 384 });
  });

  it('does not upscale an image already smaller than maxDimension', async () => {
    mockSaveAsync.mockResolvedValue({ uri: 'file:///tmp/resized.webp', width: 200, height: 150 });

    await resizeImageForUpload('file:///tmp/small.jpg', { width: 200, height: 150 }, 512);

    expect(mockResize).toHaveBeenCalledWith({ width: 200, height: 150 });
  });

  it('surfaces a manipulator failure as a plain, user-facing Error rather than crashing', async () => {
    mockRenderAsync.mockRejectedValue(new Error('native module boom'));

    await expect(
      resizeImageForUpload('file:///tmp/photo.jpg', { width: 4000, height: 3000 }, 512),
    ).rejects.toThrow('Could not prepare the image for upload.');
  });

  it('surfaces a save failure the same way', async () => {
    mockSaveAsync.mockRejectedValue(new Error('disk full'));

    await expect(
      resizeImageForUpload('file:///tmp/photo.jpg', { width: 4000, height: 3000 }, 512),
    ).rejects.toThrow('Could not prepare the image for upload.');
  });
});
