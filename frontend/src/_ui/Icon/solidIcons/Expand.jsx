import React from 'react';

const Expand = ({ fill = '#889096', width = '13', className = '', viewBox = '0 0 14 14' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={width}
    height={width}
    viewBox={viewBox}
    fill="none"
    className={className}
  >
    <path
      d="M3.13755 12.3625H6.00005C6.31925 12.3625 6.58863 12.4723 6.8082 12.6918C7.02777 12.9114 7.13755 13.1808 7.13755 13.5C7.13755 13.8192 7.02777 14.0886 6.8082 14.3081C6.58863 14.5277 6.31925 14.6375 6.00005 14.6375H2.00005C1.68085 14.6375 1.41147 14.5277 1.1919 14.3081C0.972332 14.0886 0.862549 13.8192 0.862549 13.5V9.49999C0.862549 9.18079 0.972332 8.9114 1.1919 8.69184C1.41147 8.47227 1.68085 8.36249 2.00005 8.36249C2.31925 8.36249 2.58863 8.47227 2.8082 8.69184C3.02777 8.9114 3.13755 9.18079 3.13755 9.49999V12.3625ZM12.8625 2.63749H10C9.68085 2.63749 9.41147 2.5277 9.1919 2.30814C8.97233 2.08857 8.86255 1.81919 8.86255 1.49999C8.86255 1.18079 8.97233 0.911405 9.1919 0.691838C9.41147 0.472271 9.68085 0.362488 10 0.362488H14C14.3192 0.362488 14.5886 0.472271 14.8082 0.691838C15.0278 0.911405 15.1375 1.18079 15.1375 1.49999V5.49999C15.1375 5.81919 15.0278 6.08857 14.8082 6.30814C14.5886 6.5277 14.3192 6.63749 14 6.63749C13.6808 6.63749 13.4115 6.5277 13.1919 6.30814C12.9723 6.08857 12.8625 5.81919 12.8625 5.49999V2.63749Z"
      fill={fill}
    />
  </svg>
);

export default Expand;
