import React from 'react';

const ArrowTransfer = ({ fill = '#C1C8CD', width = '25', className = '', viewBox = '0 0 25 25' }) => (
  <svg
    width={width}
    height={width}
    viewBox={viewBox}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M16.0303 12.3194L19.0303 9.31939C19.3232 9.0265 19.3232 8.55163 19.0303 8.25873L16.0303 5.25873C15.7374 4.96584 15.2626 4.96584 14.9697 5.25873C14.6768 5.55163 14.6768 6.0265 14.9697 6.31939L16.6893 8.03906L6.5 8.03906C6.08579 8.03906 5.75 8.37485 5.75 8.78906C5.75 9.20328 6.08579 9.53906 6.5 9.53906L16.6893 9.53906L14.9697 11.2587C14.6768 11.5516 14.6768 12.0265 14.9697 12.3194C15.2626 12.6123 15.7374 12.6123 16.0303 12.3194ZM5.96967 16.2587C5.67678 16.5516 5.67678 17.0265 5.96967 17.3194L8.96967 20.3194C9.26256 20.6123 9.73744 20.6123 10.0303 20.3194C10.3232 20.0265 10.3232 19.5516 10.0303 19.2587L8.31066 17.5391H18.5C18.9142 17.5391 19.25 17.2033 19.25 16.7891C19.25 16.3748 18.9142 16.0391 18.5 16.0391H8.31066L10.0303 14.3194C10.3232 14.0265 10.3232 13.5516 10.0303 13.2587C9.73744 12.9658 9.26256 12.9658 8.96967 13.2587L5.96967 16.2587Z"
      fill={fill}
    />
  </svg>
);

export default ArrowTransfer;
